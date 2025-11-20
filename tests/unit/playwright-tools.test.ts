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

    it('should have playwright_click tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Click an element');
      expect(tool?.inputSchema.required).toContain('selector');
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
});
