#!/usr/bin/env node

/**
 * Browser Agent Gateway smoke test (repeatable, offline-safe).
 *
 * Runs the core usable flows end-to-end:
 *   1. Create a gateway session.
 *   2. Report health/capabilities.
 *   3. Public browse (navigate to a safe public page) — falls back to Playwright
 *      when Obscura is not configured, demonstrating the fallback path.
 *   4. Report the execution telemetry summary.
 *   5. Quick research smoke using the FakeSearchProvider (no billed API, no
 *      network required).
 *
 * If the Playwright chromium browser is not installed, the script prints a
 * clear message and exits non-zero WITHOUT crashing.
 */

import chalk from 'chalk';
import { createGateway } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { ResearchAgent } from '../lib/browser-gateway/application/research-agent.js';
import { SearchProviderRouter } from '../lib/browser-gateway/application/search-provider-router.js';
import { FakeSearchProvider } from '../lib/browser-gateway/infrastructure/search/fake-search-provider.js';
import type { SourceReader } from '../lib/browser-gateway/application/source-reader.js';

const SESSION_ID = 'smoke-session';
const SAFE_PUBLIC_URL = 'https://example.com';

function fail(message: string): never {
  console.error(chalk.red(`\n✗ ${message}`));
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(chalk.blue('\n🧪 Browser Agent Gateway Smoke\n'));

  // 1) Create a gateway session.
  const gateway = createGateway();
  gateway.createSession(SESSION_ID, { transport: 'smoke' });
  console.log(chalk.green('✓ Session created:'), SESSION_ID);

  // 2) Report health/capabilities.
  const health = await gateway.health();
  const capabilities = gateway.capabilities();
  console.log(chalk.green('\n✓ Health:'), health.healthy ? 'healthy' : 'degraded');
  for (const engine of health.engines) {
    console.log(`   engine ${engine.id}: ${engine.healthy ? 'healthy' : 'unhealthy'} — ${engine.details ?? ''}`);
  }
  console.log(chalk.gray('   LLM routing:'), capabilities.llm.provider, '/', capabilities.llm.model);

  // 3) Public browse — Obscura-first, Playwright fallback.
  console.log(chalk.green('\n✓ Public browse:'), SAFE_PUBLIC_URL);
  const browse = await gateway.executeTask({
    taskId: `smoke-browse-${Date.now()}`,
    sessionId: SESSION_ID,
    action: { type: 'navigate', url: SAFE_PUBLIC_URL },
  });

  if (browse.status !== 'success') {
    if (browse.status === 'blocked') {
      fail(`navigation blocked: ${browse.category} — ${browse.reason}`);
    }
    if (browse.status === 'manual_escalation_required') {
      if (/browser.*not.*installed|executable doesn't exist|playwright.*install|chromium.*not.*found/i.test(browse.reason)) {
        console.error(chalk.red('\n✗ Playwright chromium is not installed.'));
        console.error(chalk.yellow('   Run: npx playwright install chromium'));
        console.error(chalk.gray('   Then re-run: npm run smoke:gateway\n'));
        process.exit(1);
      }
      fail(`navigation required manual escalation: ${browse.reason}`);
    }
    fail('navigation returned an unexpected status');
  }

  const data = browse.data as { url?: string; title?: string };
  console.log(chalk.gray('   loaded:'), data.url ?? SAFE_PUBLIC_URL, '| title:', data.title ?? '(n/a)');

  // 4) Report the execution telemetry summary.
  console.log(chalk.green('\n✓ Execution telemetry:'));
  console.log('   ', JSON.stringify(browse.telemetry));

  // 5) Quick research smoke using the FakeSearchProvider (offline-safe).
  console.log(chalk.green('\n✓ Quick research smoke (FakeSearchProvider, offline):'));
  const fakeProvider = new FakeSearchProvider('fake', {
    results: [
      {
        title: 'Example Domain',
        url: 'https://example.com',
        snippet: 'Example Domain is used for illustrative examples in documents.',
      },
      {
        title: 'IANA Example',
        url: 'https://www.iana.org/domains/example',
        snippet: 'This domain is reserved for use in illustrative examples in documents.',
      },
    ],
    available: true,
  });
  const router = new SearchProviderRouter([fakeProvider], {
    candidates: ['fake'],
    fallbackBehavior: 'next-available',
  });

  // Offline-safe reader: returns a fixture page instead of opening a browser.
  const reader: SourceReader = {
    read: async (url) => ({
      status: 'success',
      page: {
        url,
        title: 'Example Domain',
        text: 'Example Domain is used for illustrative examples in documents. This domain is reserved for use in illustrative examples.',
        headings: ['Example Domain'],
        fetchedAt: new Date().toISOString(),
      },
    }),
  };

  const agent = new ResearchAgent({ searchRouter: router, reader });
  const outcome = await agent.run({
    question: 'What is the Example Domain used for?',
    mode: 'quick',
    sessionId: SESSION_ID,
  });

  if (outcome.status === 'blocked') {
    fail(`research blocked: ${outcome.reason}`);
  }
  if (outcome.status === 'partial') {
    console.log(chalk.yellow('   research partial:'), outcome.reason);
  }
  if ('report' in outcome) {
    console.log(chalk.gray('   answer:'), outcome.report.answer);
    console.log(chalk.gray('   confidence:'), outcome.report.confidence);
    console.log(chalk.gray('   citations:'), outcome.report.citations.length);
  }
  console.log(chalk.gray('   research telemetry:'), JSON.stringify(outcome.telemetry));

  // Cleanup.
  await gateway.closeSession(SESSION_ID).catch(() => undefined);

  console.log(chalk.green('\n🎉 Smoke passed! The Browser Agent Gateway is usable.\n'));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/browser.*not.*installed|executable doesn't exist|playwright.*install|chromium.*not.*found/i.test(message)) {
    console.error(chalk.red('\n✗ Playwright chromium is not installed.'));
    console.error(chalk.yellow('   Run: npx playwright install chromium'));
    console.error(chalk.gray('   Then re-run: npm run smoke:gateway\n'));
    process.exit(1);
  }
  fail(message);
});
