import { hkdfSync } from 'crypto';

/**
 * Shared trusted key resolver/validator (BLOCKER-I / HIGH-J).
 *
 * This module is the SINGLE source of truth for deciding whether a configured
 * MASTER_KEY / APPROVAL_SECRET is strong enough to be used at runtime. Both the
 * runtime (approval registry, session vault, gateway factory) and the diagnostic
 * script (`scripts/diagnose.ts`) MUST use these functions so that security does
 * not depend on the operator running `diagnose` first.
 *
 * The public placeholder `MASTER_KEY=your-32-character-master-key-here` from
 * `.env.example` satisfies a naive `length >= 32` check but is publicly known,
 * so it must NEVER be accepted as a usable runtime key.
 */

/** Minimum length for a usable MASTER_KEY (>=32 chars). */
export const MIN_MASTER_KEY_LENGTH = 32;

/** Minimum length for a strong APPROVAL_SECRET (>=32 chars). */
export const MIN_APPROVAL_SECRET_LENGTH = 32;

/** Fixed HKDF info/salt for deriving the approval subkey from MASTER_KEY. */
const APPROVAL_HKDF_INFO = 'browser-gateway-approval';
const APPROVAL_HKDF_SALT = 'browser-gateway-approval-salt-v1';

/**
 * Derive a stable, non-static approval subkey from a MASTER_KEY via HKDF-SHA256.
 * The same MASTER_KEY always yields the same subkey (so two processes sharing a
 * MASTER_KEY can cross-verify), but the subkey is NOT a hardcoded default and is
 * distinct from the master key itself (key separation).
 */
export function deriveApprovalSecret(masterKey: string): string {
  const derived = hkdfSync('sha256', Buffer.from(masterKey, 'utf-8'), APPROVAL_HKDF_SALT, APPROVAL_HKDF_INFO, 32);
  return Buffer.from(derived).toString('hex');
}

/**
 * Known placeholder/default MASTER_KEY values that must never be accepted as a
 * usable runtime key. At minimum the public `.env.example` placeholder.
 */
export const KNOWN_INSECURE_MASTER_KEYS: string[] = [
  'your-32-character-master-key-here',
  'your-master-key-here',
  'change-me-master-key',
  'master-key-placeholder',
  'example-master-key',
  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
];

/** Substrings that indicate a placeholder/example value. */
const PLACEHOLDER_SUBSTRINGS = ['your-', 'changeme', 'placeholder', 'example', 'xxxx'];

/** True when every character in the string is identical (e.g. 'aaaa...'). */
function isAllSameChar(s: string): boolean {
  if (s.length === 0) return false;
  const first = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] !== first) return false;
  }
  return true;
}

/** True when the value looks like a known placeholder / example / weak default. */
function isPlaceholderLike(value: string): boolean {
  if (KNOWN_INSECURE_MASTER_KEYS.includes(value)) return true;
  if (isAllSameChar(value)) return true;
  const lower = value.toLowerCase();
  for (const sub of PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}

/**
 * True only if `key` is a non-empty string, length >= MIN_MASTER_KEY_LENGTH, and
 * NOT a known insecure/placeholder value.
 */
export function isValidMasterKey(key: string | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length < MIN_MASTER_KEY_LENGTH) return false;
  return !isPlaceholderLike(key);
}

/**
 * Returns `process.env.MASTER_KEY` if it is a valid strong key, else undefined.
 */
export function resolveMasterKey(): string | undefined {
  const key = process.env.MASTER_KEY;
  return isValidMasterKey(key) ? key : undefined;
}

/**
 * True only if `secret` is a non-empty string, length >= MIN_APPROVAL_SECRET_LENGTH,
 * and not a known placeholder/weak value (rejects 'x', 'test', 'dev-approval-secret',
 * all-same-char, and placeholder substrings).
 */
export function isStrongApprovalSecret(secret: string | undefined): boolean {
  if (!secret || typeof secret !== 'string') return false;
  if (secret.length < MIN_APPROVAL_SECRET_LENGTH) return false;
  if (isAllSameChar(secret)) return false;
  const lower = secret.toLowerCase();
  if (lower === 'x' || lower === 'test' || lower === 'dev-approval-secret') return false;
  for (const sub of PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(sub)) return false;
  }
  return true;
}

/**
 * The SINGLE source of truth for the approval secret.
 *
 * Returns `process.env.APPROVAL_SECRET` if it is strong, else if
 * `process.env.MASTER_KEY` is a valid strong key returns the HKDF-derived
 * approval subkey, else undefined (fail-closed).
 */
export function resolveApprovalSecret(): string | undefined {
  const approval = process.env.APPROVAL_SECRET;
  if (isStrongApprovalSecret(approval)) return approval;
  const masterKey = process.env.MASTER_KEY;
  if (isValidMasterKey(masterKey)) return deriveApprovalSecret(masterKey as string);
  return undefined;
}
