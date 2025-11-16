import { ObservationData, InteractiveElement } from '../../../lib/types/index.js';
import { logger } from '../../../lib/observability/logger.js';

export class DOMObserver {
  async observe(domStructure: any): Promise<ObservationData> {
    const start = Date.now();

    try {
      const elements: InteractiveElement[] = [];

      // Extract from inputs
      if (domStructure.inputs) {
        domStructure.inputs.forEach((input: any) => {
          elements.push({
            type: input.type || 'input',
            selector: this.generateInputSelector(input),
            label: input.label || input.placeholder,
            value: input.value,
            placeholder: input.placeholder,
          });
        });
      }

      // Extract from buttons
      if (domStructure.buttons) {
        domStructure.buttons.forEach((button: any) => {
          elements.push({
            type: 'button',
            selector: this.generateButtonSelector(button),
            label: button.text,
          });
        });
      }

      // Extract from links
      if (domStructure.links) {
        domStructure.links.slice(0, 10).forEach((link: any) => {
          elements.push({
            type: 'link',
            selector: `a:has-text("${link.text?.substring(0, 30)}")`,
            label: link.text,
            value: link.href,
          });
        });
      }

      logger.debug('DOM observation complete', {
        elementCount: elements.length,
        duration: Date.now() - start,
      });

      return {
        method: 'dom',
        elements,
        structure: domStructure,
        cost: 0,
        speed: 'medium',
      };
    } catch (error: any) {
      logger.error('DOM observation failed', { error: error.message });
      throw error;
    }
  }

  private generateInputSelector(input: any): string {
    if (input.id) {
      return `#${input.id}`;
    }

    if (input.name) {
      return `[name="${input.name}"]`;
    }

    if (input.placeholder) {
      return `[placeholder="${input.placeholder}"]`;
    }

    return `input[type="${input.type || 'text'}"]`;
  }

  private generateButtonSelector(button: any): string {
    if (button.id) {
      return `#${button.id}`;
    }

    if (button.text) {
      return `button:has-text("${button.text}")`;
    }

    if (button.type === 'submit') {
      return 'button[type="submit"]';
    }

    return 'button';
  }

  isEmpty(data: ObservationData): boolean {
    return data.elements.length === 0;
  }
}
