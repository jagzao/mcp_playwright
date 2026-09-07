import { describe, it, expect } from 'vitest';
import { playwrightTools } from '../../mcp-server/src/tools/playwright/index.js';

describe('Playwright Tools', () => {
  describe('Tool Definitions', () => {
    it('should have playwright_navigate tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_navigate');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Navigate to a URL');
      expect(tool?.inputSchema.required).toContain('url');
      expect(tool?.inputSchema.properties.url).toBeDefined();
      expect(tool?.inputSchema.properties.waitUntil).toBeDefined();
    });

    it('should have playwright_click tool (gated through the gateway safety/approval gate)', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');

      expect(tool).toBeDefined();
      // HIGH-D/BLOCKER-E: the legacy click is now routed through the gateway so
      // a raw click is approval-required unless a one-time token is supplied.
      expect(tool?.description).toContain('approval');
      expect(tool?.inputSchema.required).toContain('selector');
      expect(tool?.inputSchema.properties.approval).toBeDefined();
    });

    it('should have playwright_fill tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_fill');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Fill a form field');
      expect(tool?.inputSchema.required).toEqual(['selector', 'value']);
    });

    it('should have playwright_screenshot tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_screenshot');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Take a screenshot');
      expect(tool?.inputSchema.properties.path).toBeDefined();
      expect(tool?.inputSchema.properties.fullPage).toBeDefined();
    });

    it('should have playwright_wait_for tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_wait_for');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Wait for an element to appear');
      expect(tool?.inputSchema.required).toContain('selector');
    });

    it('should have playwright_get_text tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_get_text');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Get text content from element');
      expect(tool?.inputSchema.required).toContain('selector');
    });

    it('should have playwright_close tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_close');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Close the browser');
    });
  });

  describe('Tool Input Schemas', () => {
    it('should validate navigate waitUntil options', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_navigate');

      expect(tool?.inputSchema.properties.waitUntil.enum).toEqual([
        'load',
        'domcontentloaded',
        'networkidle',
      ]);
    });

    it('should validate wait_for state options', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_wait_for');

      expect(tool?.inputSchema.properties.state.enum).toEqual([
        'attached',
        'detached',
        'visible',
        'hidden',
      ]);
    });
  });

  describe('Tool Count', () => {
    it('should have all essential tools', () => {
      const essentialTools = [
        'playwright_navigate',
        'playwright_click',
        'playwright_fill',
        'playwright_screenshot',
        'playwright_wait_for',
        'playwright_get_text',
        'playwright_close',
      ];

      essentialTools.forEach((toolName) => {
        const tool = playwrightTools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
      });

      expect(playwrightTools.length).toBe(7);
    });
  });

  describe('HIGH-D/BLOCKER-E: legacy playwright_click is gated through the gateway', () => {
    it('a raw click on a side-effect selector is approval-required (no browser needed — gate blocks first)', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      // The gateway safety gate blocks a raw click BEFORE any engine runs, so
      // this does not require a browser. A hostile page can put a[href] /
      // role=tab on a destructive control; the raw click must NOT auto-execute.
      const result = await tool.execute({ selector: '#delete-account' });
      expect(result.success).toBe(false);
      expect(result.category).toBe('approval_required');
      expect(result.pendingId).toBeTruthy(); // operator can approve it
    });

    it('a raw click on a previously-safe-looking selector (a[href]) is also approval-required', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      // HIGH-D: even a[href] / [role="tab"] must not auto-allow a raw click.
      const result = await tool.execute({ selector: 'a[href="/about"]' });
      expect(result.success).toBe(false);
      expect(result.category).toBe('approval_required');
    });
  });
});
