import { describe, expect, it } from 'vitest';
import {
  isValidMasterKey,
  isStrongApprovalSecret,
  resolveApprovalSecret,
  resolveMasterKey,
  deriveApprovalSecret,
  MIN_APPROVAL_SECRET_LENGTH,
} from '../../../lib/security/secret-resolver.js';

const STRONG_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const STRONG_MASTER = 'master-key-0123456789abcdef0123456789abcdef';

describe('secret-resolver (BLOCKER-I / HIGH-J shared source of truth)', () => {
  describe('isValidMasterKey', () => {
    it('accepts a strong random key', () => {
      expect(isValidMasterKey(STRONG_MASTER)).toBe(true);
    });

    it('rejects undefined / empty / too-short', () => {
      expect(isValidMasterKey(undefined)).toBe(false);
      expect(isValidMasterKey('')).toBe(false);
      expect(isValidMasterKey('short')).toBe(false);
    });

    it('rejects the public .env.example placeholder', () => {
      expect(isValidMasterKey('your-32-character-master-key-here')).toBe(false);
    });

    it('rejects all-same-char keys', () => {
      expect(isValidMasterKey('a'.repeat(32))).toBe(false);
    });

    it('rejects placeholder substrings (your-, changeme, placeholder, example, xxxx)', () => {
      expect(isValidMasterKey('your-real-key-0123456789abcdef0123456789')).toBe(false);
      expect(isValidMasterKey('changeme-0123456789abcdef0123456789abcdef')).toBe(false);
      expect(isValidMasterKey('placeholder-0123456789abcdef0123456789')).toBe(false);
      expect(isValidMasterKey('example-key-0123456789abcdef0123456789abcdef')).toBe(false);
      expect(isValidMasterKey('xxxx-0123456789abcdef0123456789abcdef')).toBe(false);
    });
  });

  describe('isStrongApprovalSecret', () => {
    it('accepts a strong secret', () => {
      expect(isStrongApprovalSecret(STRONG_SECRET)).toBe(true);
    });

    it('rejects undefined / empty / too-short', () => {
      expect(isStrongApprovalSecret(undefined)).toBe(false);
      expect(isStrongApprovalSecret('')).toBe(false);
      expect(isStrongApprovalSecret('x')).toBe(false);
      expect(isStrongApprovalSecret('test')).toBe(false);
      expect(isStrongApprovalSecret('dev-approval-secret')).toBe(false);
    });

    it('rejects all-same-char and placeholder-like secrets', () => {
      expect(isStrongApprovalSecret('a'.repeat(MIN_APPROVAL_SECRET_LENGTH))).toBe(false);
      expect(isStrongApprovalSecret('your-secret-0123456789abcdef0123456789')).toBe(false);
    });
  });

  describe('resolveMasterKey', () => {
    it('returns the env MASTER_KEY when valid, else undefined', () => {
      const prev = process.env.MASTER_KEY;
      try {
        process.env.MASTER_KEY = STRONG_MASTER;
        expect(resolveMasterKey()).toBe(STRONG_MASTER);
        process.env.MASTER_KEY = 'your-32-character-master-key-here';
        expect(resolveMasterKey()).toBeUndefined();
        delete process.env.MASTER_KEY;
        expect(resolveMasterKey()).toBeUndefined();
      } finally {
        if (prev !== undefined) process.env.MASTER_KEY = prev;
        else delete process.env.MASTER_KEY;
      }
    });
  });

  describe('resolveApprovalSecret', () => {
    it('prefers a strong APPROVAL_SECRET over MASTER_KEY', () => {
      const prevMaster = process.env.MASTER_KEY;
      const prevApproval = process.env.APPROVAL_SECRET;
      try {
        process.env.APPROVAL_SECRET = STRONG_SECRET;
        process.env.MASTER_KEY = STRONG_MASTER;
        expect(resolveApprovalSecret()).toBe(STRONG_SECRET);
      } finally {
        if (prevMaster !== undefined) process.env.MASTER_KEY = prevMaster;
        else delete process.env.MASTER_KEY;
        if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
        else delete process.env.APPROVAL_SECRET;
      }
    });

    it('derives from MASTER_KEY when APPROVAL_SECRET is absent/weak', () => {
      const prevMaster = process.env.MASTER_KEY;
      const prevApproval = process.env.APPROVAL_SECRET;
      try {
        delete process.env.APPROVAL_SECRET;
        process.env.MASTER_KEY = STRONG_MASTER;
        expect(resolveApprovalSecret()).toBe(deriveApprovalSecret(STRONG_MASTER));
        // Weak APPROVAL_SECRET is ignored in favor of MASTER_KEY.
        process.env.APPROVAL_SECRET = 'x';
        expect(resolveApprovalSecret()).toBe(deriveApprovalSecret(STRONG_MASTER));
      } finally {
        if (prevMaster !== undefined) process.env.MASTER_KEY = prevMaster;
        else delete process.env.MASTER_KEY;
        if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
        else delete process.env.APPROVAL_SECRET;
      }
    });

    it('returns undefined when neither is strong (fail-closed)', () => {
      const prevMaster = process.env.MASTER_KEY;
      const prevApproval = process.env.APPROVAL_SECRET;
      try {
        delete process.env.APPROVAL_SECRET;
        process.env.MASTER_KEY = 'your-32-character-master-key-here';
        expect(resolveApprovalSecret()).toBeUndefined();
        delete process.env.MASTER_KEY;
        expect(resolveApprovalSecret()).toBeUndefined();
      } finally {
        if (prevMaster !== undefined) process.env.MASTER_KEY = prevMaster;
        else delete process.env.MASTER_KEY;
        if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
        else delete process.env.APPROVAL_SECRET;
      }
    });
  });
});
