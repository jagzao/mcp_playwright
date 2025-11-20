import { describe, it, expect, vi } from 'vitest';
import { visionTools } from '../../mcp-server/src/tools/vision/index.js';

describe('Vision Tools', () => {
  describe('vision_get_dom_structure', () => {
    it('should have correct tool definition', () => {
      const tool = visionTools.find((t) => t.name === 'vision_get_dom_structure');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Get simplified DOM structure with interactive elements');
      expect(tool?.inputSchema.type).toBe('object');
    });

    it('should return structure when page is available', async () => {
      const tool = visionTools.find((t) => t.name === 'vision_get_dom_structure');

      // Mock page with DOM elements
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          inputs: [
            { type: 'email', name: 'email', id: 'email-input', placeholder: 'Email' },
            { type: 'password', name: 'password', id: 'pass-input', placeholder: 'Password' },
          ],
          buttons: [
            { text: 'Login', type: 'submit', id: 'login-btn' },
          ],
          links: [
            { text: 'Forgot password?', href: '/forgot-password' },
          ],
        }),
      };

      // Set current page
      const { setCurrentPage } = await import('../../mcp-server/src/tools/vision/index.js');
      setCurrentPage(mockPage as any);

      const result = await tool?.execute({});

      expect(result?.success).toBe(true);
      expect(result?.method).toBe('dom');
      expect(result?.structure.inputs).toHaveLength(2);
      expect(result?.structure.buttons).toHaveLength(1);
      expect(result?.structure.links).toHaveLength(1);
      expect(result?.cost).toBe(0);
    });
  });

  describe('vision_accessibility_tree', () => {
    it('should have correct tool definition', () => {
      const tool = visionTools.find((t) => t.name === 'vision_accessibility_tree');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Get accessibility tree of current page');
    });

    it('should return snapshot when page is available', async () => {
      const tool = visionTools.find((t) => t.name === 'vision_accessibility_tree');

      const mockSnapshot = {
        role: 'WebArea',
        name: 'Login Page',
        children: [
          { role: 'button', name: 'Login' },
          { role: 'textbox', name: 'Email' },
        ],
      };

      const mockPage = {
        accessibility: {
          snapshot: vi.fn().mockResolvedValue(mockSnapshot),
        },
      };

      const { setCurrentPage } = await import('../../mcp-server/src/tools/vision/index.js');
      setCurrentPage(mockPage as any);

      const result = await tool?.execute({});

      expect(result?.success).toBe(true);
      expect(result?.snapshot).toEqual(mockSnapshot);
    });
  });

  describe('vision_ocr', () => {
    it('should have correct tool definition', () => {
      const tool = visionTools.find((t) => t.name === 'vision_ocr');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Extract text from screenshot using OCR');
      expect(tool?.inputSchema.required).toContain('screenshotPath');
    });

    // Note: OCR test would require actual Tesseract worker, skipping integration test
    it('should require screenshotPath parameter', () => {
      const tool = visionTools.find((t) => t.name === 'vision_ocr');

      expect(tool?.inputSchema.required).toEqual(['screenshotPath']);
      expect(tool?.inputSchema.properties.screenshotPath).toBeDefined();
    });
  });
});
