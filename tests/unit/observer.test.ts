import { describe, it, expect } from 'vitest';
import { AccessibilityObserver } from '../../agent/src/observer/accessibility-observer.js';

describe('AccessibilityObserver', () => {
  const observer = new AccessibilityObserver();

  it('should extract interactive elements from accessibility tree', async () => {
    const mockSnapshot = {
      role: 'WebArea',
      children: [
        {
          role: 'button',
          name: 'Submit',
        },
        {
          role: 'textbox',
          name: 'Email',
        },
      ],
    };

    const result = await observer.observe(mockSnapshot);

    expect(result.method).toBe('accessibility');
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].type).toBe('button');
    expect(result.elements[1].type).toBe('textbox');
  });

  it('should return empty elements when no interactive elements found', async () => {
    const mockSnapshot = {
      role: 'WebArea',
      children: [],
    };

    const result = await observer.observe(mockSnapshot);

    expect(result.elements).toHaveLength(0);
    expect(observer.isEmpty(result)).toBe(true);
  });
});
