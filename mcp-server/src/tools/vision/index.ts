import { Page } from 'playwright';
import { createWorker } from 'tesseract.js';
import { logger } from '../../../../lib/observability/logger.js';

// Placeholder for page - will be passed from playwright tools
let currentPage: Page | null = null;

export function setCurrentPage(page: Page) {
  currentPage = page;
}

export const visionTools = [
  {
    name: 'vision_accessibility_tree',
    description: 'Get accessibility tree of current page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (!currentPage) {
        throw new Error('No page available. Navigate to a page first.');
      }

      const snapshot = await currentPage.accessibility.snapshot();

      // Extract interactive elements
      const elements = extractInteractiveElements(snapshot);

      return {
        success: true,
        method: 'accessibility',
        elements,
        elementCount: elements.length,
      };
    },
  },

  {
    name: 'vision_ocr',
    description: 'Extract text from screenshot using OCR',
    inputSchema: {
      type: 'object',
      properties: {
        screenshotPath: { type: 'string', description: 'Path to screenshot file' },
      },
      required: ['screenshotPath'],
    },
    async execute(args: any) {
      const { screenshotPath } = args;

      const worker = await createWorker('eng');

      try {
        const { data: { text, blocks } } = await worker.recognize(screenshotPath);

        await worker.terminate();

        return {
          success: true,
          method: 'ocr',
          text,
          blockCount: blocks.length,
          cost: 0,
        };
      } catch (error: any) {
        await worker.terminate();
        throw error;
      }
    },
  },

  {
    name: 'vision_get_dom_structure',
    description: 'Get simplified DOM structure with interactive elements',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (!currentPage) {
        throw new Error('No page available. Navigate to a page first.');
      }

      const structure = await currentPage.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
          .map((el: any) => ({
            type: el.type || el.tagName.toLowerCase(),
            name: el.name,
            id: el.id,
            placeholder: el.placeholder,
            value: el.value,
            label: el.labels?.[0]?.textContent?.trim(),
          }));

        const buttons = Array.from(document.querySelectorAll('button, [type="submit"], [role="button"]'))
          .map((el: any) => ({
            text: el.textContent?.trim(),
            type: el.type,
            id: el.id,
            class: el.className,
          }));

        const links = Array.from(document.querySelectorAll('a'))
          .slice(0, 20) // Limit to first 20 links
          .map((el: any) => ({
            text: el.textContent?.trim(),
            href: el.href,
          }));

        return { inputs, buttons, links };
      });

      return {
        success: true,
        method: 'dom',
        structure,
        cost: 0,
      };
    },
  },
];

function extractInteractiveElements(snapshot: any, elements: any[] = []): any[] {
  if (!snapshot) return elements;

  if (snapshot.role) {
    const interactiveRoles = [
      'button',
      'textbox',
      'link',
      'checkbox',
      'radio',
      'combobox',
      'searchbox',
      'slider',
      'tab',
      'menuitem',
    ];

    if (interactiveRoles.includes(snapshot.role)) {
      elements.push({
        role: snapshot.role,
        name: snapshot.name,
        value: snapshot.value,
        description: snapshot.description,
      });
    }
  }

  if (snapshot.children) {
    snapshot.children.forEach((child: any) => extractInteractiveElements(child, elements));
  }

  return elements;
}
