import { describe, it, expect } from 'vitest';
import { InputSanitizer } from '../../lib/security/input-sanitizer.js';

describe('InputSanitizer', () => {
  const sanitizer = new InputSanitizer();

  describe('validateURL', () => {
    it('should accept valid HTTP URLs', () => {
      expect(sanitizer.validateURL('http://example.com')).toBe(true);
      expect(sanitizer.validateURL('https://example.com')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(sanitizer.validateURL('javascript:alert(1)')).toBe(false);
      expect(sanitizer.validateURL('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(sanitizer.validateURL('not-a-url')).toBe(false);
    });
  });

  describe('validateSelector', () => {
    it('should accept safe CSS selectors', () => {
      expect(sanitizer.validateSelector('#myId')).toBe(true);
      expect(sanitizer.validateSelector('.myClass')).toBe(true);
      expect(sanitizer.validateSelector('button[type="submit"]')).toBe(true);
    });

    it('should reject dangerous selectors', () => {
      expect(sanitizer.validateSelector('javascript:alert(1)')).toBe(false);
      expect(sanitizer.validateSelector('expression(alert(1))')).toBe(false);
    });
  });

  describe('sanitizeForXSS', () => {
    it('should escape HTML entities', () => {
      const input = '<script>alert("XSS")</script>';
      const sanitized = sanitizer.sanitizeForXSS(input);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });
  });
});
