import { ObservationData, InteractiveElement } from '../../../lib/types/index.js';
import { logger } from '../../../lib/observability/logger.js';

export class AccessibilityObserver {
  async observe(snapshot: any): Promise<ObservationData> {
    const start = Date.now();

    try {
      const elements = this.extractInteractiveElements(snapshot);

      logger.debug('Accessibility observation complete', {
        elementCount: elements.length,
        duration: Date.now() - start,
      });

      return {
        method: 'accessibility',
        elements,
        structure: {
          buttons: elements.filter(e => e.role === 'button'),
          inputs: elements.filter(e => e.role === 'textbox'),
          links: elements.filter(e => e.role === 'link'),
        },
        cost: 0,
        speed: 'fast',
      };
    } catch (error: any) {
      logger.error('Accessibility observation failed', { error: error.message });
      throw error;
    }
  }

  private extractInteractiveElements(
    snapshot: any,
    elements: InteractiveElement[] = [],
    path: string = ''
  ): InteractiveElement[] {
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
          type: snapshot.role,
          selector: this.generateSelector(snapshot, path),
          label: snapshot.name,
          value: snapshot.value,
          role: snapshot.role,
        });
      }
    }

    if (snapshot.children) {
      snapshot.children.forEach((child: any, index: number) => {
        this.extractInteractiveElements(child, elements, `${path}[${index}]`);
      });
    }

    return elements;
  }

  private generateSelector(node: any, path: string): string {
    // Try to generate a reasonable selector
    if (node.name) {
      // Use aria-label or text content
      return `[aria-label="${node.name}"]`;
    }

    if (node.role === 'button') {
      return 'button';
    }

    if (node.role === 'textbox') {
      return 'input[type="text"], textarea';
    }

    if (node.role === 'link') {
      return 'a';
    }

    // Fallback to a generic selector
    return `[role="${node.role}"]`;
  }

  isEmpty(data: ObservationData): boolean {
    return data.elements.length === 0;
  }
}
