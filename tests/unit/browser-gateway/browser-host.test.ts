import { describe, expect, it } from 'vitest';
import { BrowserHost } from '../../../lib/browser-gateway/application/browser-host.js';
import type { BrowserRuntime } from '../../../lib/browser-gateway/domain/browser-runtime.js';
import type { BrowserEngineId } from '../../../lib/browser-gateway/domain/browser-result.js';

// --- Fake runtime (no real browser) ----------------------------------------

class FakeRuntime implements BrowserRuntime {
  readonly engine: BrowserEngineId = 'playwright';
  openCalls = 0;
  closeCalls = 0;
  alive = true;
  url = 'https://example.com/login';
  private readonly openSessions = new Set<string>();

  async openSession(sessionId: string, opts?: { headed?: boolean }): Promise<void> {
    this.openCalls += 1;
    this.openSessions.add(sessionId);
    this.lastHeaded = opts?.headed ?? false;
  }
  lastHeaded = false;

  async currentUrl(sessionId: string): Promise<string | undefined> {
    return this.openSessions.has(sessionId) ? this.url : undefined;
  }

  async isAlive(sessionId: string): Promise<boolean> {
    return this.openSessions.has(sessionId) && this.alive;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.closeCalls += 1;
    this.openSessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    this.openSessions.clear();
  }
}

function makeHost(runtime?: FakeRuntime, idleTtlMs = 0): { host: BrowserHost; runtime: FakeRuntime } {
  const rt = runtime ?? new FakeRuntime();
  const host = new BrowserHost({ runtime: rt, idleTtlMs });
  return { host, runtime: rt };
}

// --- Tests ------------------------------------------------------------------

describe('BrowserHost persistent lifecycle + HITL (Phase C)', () => {
  it('state machine: created -> active -> waiting_for_user -> resumable -> active', async () => {
    const { host, runtime } = makeHost();
    const created = await host.createSession('s1', { headed: true });
    expect(created.status).toBe('created');

    // Simulate the session becoming active (e.g. after a task runs).
    created.status = 'active';

    const suspend = await host.suspendForUser('s1', 'login required');
    expect(suspend.ok).toBe(true);
    if (suspend.ok) {
      expect(suspend.status).toBe('waiting_for_user');
      expect(host.getSessionStatus('s1')).toBe('waiting_for_user');
      // Browser must remain open while waiting.
      expect(runtime.openCalls).toBeGreaterThan(0);
      expect(runtime.closeCalls).toBe(0);
    }

    const resume = await host.resumeSession('s1', suspend.ok ? suspend.checkpoint.checkpointId : '');
    expect(resume.ok).toBe(true);
    if (resume.ok) {
      expect(resume.status).toBe('active');
      expect(resume.recovery).toBe('live_continuity');
      expect(host.getSessionStatus('s1')).toBe('active');
    }
  });

  it('waiting_for_user is a first-class successful state, not an error', async () => {
    const { host } = makeHost();
    await host.createSession('s1', { headed: true });
    const suspend = await host.suspendForUser('s1', 'mfa');
    expect(suspend.ok).toBe(true);
    if (suspend.ok) {
      expect(suspend.status).toBe('waiting_for_user');
    }
    expect(host.getSessionStatus('s1')).toBe('waiting_for_user');
  });

  it('suspendForUser keeps the session alive and records a checkpoint', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('s1', { headed: true });
    const suspend = await host.suspendForUser('s1', 'captcha', { activityId: 'act-1' });
    expect(suspend.ok).toBe(true);
    if (suspend.ok) {
      expect(suspend.checkpoint.activityId).toBe('act-1');
      expect(suspend.checkpoint.browserSessionId).toBe('s1');
      expect(suspend.checkpoint.url).toBe('https://example.com/login');
      expect(suspend.checkpoint.reason).toBe('captcha');
      expect(suspend.checkpoint.checkpointId).toContain('s1');
    }
    // No close happened during suspension.
    expect(runtime.closeCalls).toBe(0);
    expect(host.getSession('s1')?.checkpoint).toBeDefined();
  });

  it('resumeSession with the correct checkpoint resumes the same logical session', async () => {
    const { host } = makeHost();
    await host.createSession('s1', { headed: true });
    const suspend = await host.suspendForUser('s1', 'login');
    expect(suspend.ok).toBe(true);
    if (!suspend.ok) return;

    const resume = await host.resumeSession('s1', suspend.checkpoint.checkpointId);
    expect(resume.ok).toBe(true);
    if (resume.ok) {
      expect(resume.recovery).toBe('live_continuity');
      expect(resume.url).toBe('https://example.com/login');
    }
  });

  it('resumeSession rejects a wrong or missing checkpoint', async () => {
    const { host } = makeHost();
    await host.createSession('s1', { headed: true });
    await host.suspendForUser('s1', 'login');

    const wrong = await host.resumeSession('s1', 'ck-wrong');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toMatch(/checkpoint/i);

    const missing = await host.resumeSession('s1', '');
    expect(missing.ok).toBe(false);
  });

  it('session isolation: two sessions checkpoints/browser state are independent', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('sA', { headed: true });
    await host.createSession('sB', { headed: true });
    const a = await host.suspendForUser('sA', 'login A');
    const b = await host.suspendForUser('sB', 'login B');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Resuming A must not touch B.
    const resumeA = await host.resumeSession('sA', a.checkpoint.checkpointId);
    expect(resumeA.ok).toBe(true);
    expect(host.getSessionStatus('sB')).toBe('waiting_for_user');

    // B's checkpoint is distinct from A's.
    expect(a.checkpoint.checkpointId).not.toBe(b.checkpoint.checkpointId);
    expect(a.checkpoint.browserSessionId).toBe('sA');
    expect(b.checkpoint.browserSessionId).toBe('sB');

    // A wrong checkpoint from B cannot resume A.
    const cross = await host.resumeSession('sA', b.checkpoint.checkpointId);
    expect(cross.ok).toBe(false);
    expect(runtime.closeCalls).toBe(0);
  });

  it('WAITING_FOR_USER is not garbage-collected by idle TTL', async () => {
    const { host, runtime } = makeHost(new FakeRuntime(), 10);
    await host.createSession('s1', { headed: true });
    await host.suspendForUser('s1', 'login');

    const reclaimed = await host.reapIdle(Date.now() + 100000);
    expect(reclaimed).toEqual([]);
    expect(host.getSessionStatus('s1')).toBe('waiting_for_user');
    expect(runtime.closeCalls).toBe(0);
  });

  it('explicit closeSession releases the session', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('s1', { headed: true });
    await host.suspendForUser('s1', 'login');

    const close = await host.closeSession('s1');
    expect(close.ok).toBe(true);
    expect(runtime.closeCalls).toBe(1);
    expect(host.getSession('s1')).toBeUndefined();
  });

  it('lost-browser detection returns a typed recovery status, not a fake same-page', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('s1', { headed: true });
    const suspend = await host.suspendForUser('s1', 'login');
    expect(suspend.ok).toBe(true);
    if (!suspend.ok) return;

    // Simulate a browser process crash.
    runtime.alive = false;

    const resume = await host.resumeSession('s1', suspend.checkpoint.checkpointId);
    expect(resume.ok).toBe(false);
    if (!resume.ok) {
      expect(resume.reason).toMatch(/reauthentication/i);
    }
    expect(host.getSessionStatus('s1')).toBe('reauthentication_required');
    expect(host.getSession('s1')?.recovery).toBe('reauthentication_required');
  });

  it('checkpointSession reports live continuity vs reauthentication_required', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('s1', { headed: true });
    await host.suspendForUser('s1', 'login');

    const live = await host.checkpointSession('s1');
    expect(live.recovery).toBe('live_continuity');
    expect(live.alive).toBe(true);

    runtime.alive = false;
    const lost = await host.checkpointSession('s1');
    expect(lost.recovery).toBe('reauthentication_required');
    expect(lost.alive).toBe(false);
  });

  it('suspendForUser pins to headed Playwright (reopens headed if needed)', async () => {
    const { host, runtime } = makeHost();
    await host.createSession('s1', { headed: false });
    expect(runtime.lastHeaded).toBe(false);

    await host.suspendForUser('s1', 'login');
    expect(runtime.lastHeaded).toBe(true);
    expect(host.getSession('s1')?.headed).toBe(true);
  });

  it('listWaitingSessions returns only waiting sessions', async () => {
    const { host } = makeHost();
    await host.createSession('sA', { headed: true });
    await host.createSession('sB', { headed: true });
    await host.suspendForUser('sA', 'login A');

    const waiting = host.listWaitingSessions();
    expect(waiting.map((s) => s.sessionId)).toEqual(['sA']);
  });
});
