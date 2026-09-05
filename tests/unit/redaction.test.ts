import { describe, it, expect } from 'vitest';
import { redactObject, redactValue, REDACTED } from '../../lib/security/redaction.js';

describe('redaction', () => {
  describe('redactValue', () => {
    it('should redact long hex strings (API keys / hashes)', () => {
      expect(redactValue('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(REDACTED);
    });

    it('should redact JWT-like tokens', () => {
      expect(redactValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe(REDACTED);
    });

    it('should redact bearer tokens', () => {
      expect(redactValue('Bearer abcdef1234567890abcdef1234567890')).toBe(REDACTED);
    });

    it('should leave ordinary strings unchanged', () => {
      expect(redactValue('hello world')).toBe('hello world');
      expect(redactValue('user@example.com')).toBe('user@example.com');
    });
  });

  describe('redactObject', () => {
    it('should redact values under sensitive keys', () => {
      const input = {
        selector: '#email',
        value: 'my-secret-password',
        password: 'hunter2',
        apiKey: 'sk-1234567890abcdef1234567890abcdef',
      };
      const out = redactObject(input) as Record<string, unknown>;

      expect(out.selector).toBe('#email');
      expect(out.value).toBe(REDACTED); // `value` carries form/credential data
      expect(out.password).toBe(REDACTED);
      expect(out.apiKey).toBe(REDACTED);
    });

    it('should redact secret-shaped values even under non-sensitive keys', () => {
      const input = { value: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' };
      const out = redactObject(input) as Record<string, unknown>;
      expect(out.value).toBe(REDACTED);
    });

    it('should not mutate the original object', () => {
      const input = { password: 'hunter2' };
      redactObject(input);
      expect(input.password).toBe('hunter2');
    });

    it('should handle nested objects and arrays', () => {
      const input = {
        form: {
          email: 'user@example.com',
          password: 'hunter2',
        },
        tags: ['a', 'b'],
      };
      const out = redactObject(input) as any;
      expect(out.form.email).toBe('user@example.com');
      expect(out.form.password).toBe(REDACTED);
      expect(out.tags).toEqual(['a', 'b']);
    });

    it('should not leak a fake password/API key in the redacted output', () => {
      const input = {
        selector: '#login',
        value: 'supersecretpassword123',
        password: 'supersecretpassword123',
        apiKey: 'sk-abcdef1234567890abcdef1234567890',
      };
      const serialized = JSON.stringify(redactObject(input));
      expect(serialized).not.toContain('supersecretpassword123');
      expect(serialized).not.toContain('sk-abcdef1234567890abcdef1234567890');
      expect(serialized).toContain(REDACTED);
    });
  });
});
