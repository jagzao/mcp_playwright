/**
 * Redaction utilities for preventing secret/credential leakage in logs and
 * tool results.
 *
 * The goal is to never write raw credential/form secret values to logs or
 * return them in tool results. This module provides:
 *  - `redactObject`: deep-redacts an object by key name and by value shape.
 *  - `redactValue`: redacts a single string value if it looks like a secret.
 */

// Keys whose values are treated as secrets regardless of content.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'apiKey',
  'authorization',
  'auth',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'client_secret',
  'clientSecret',
  'private_key',
  'privateKey',
  'mfa',
  'otp',
  'recovery_code',
  'recoveryCode',
  'linkedin_password',
  'linkedin_email',
  // `value` is the fill-tool argument that carries form values/credentials.
  'value',
]);

// Value shapes that strongly indicate a secret even under a non-sensitive key.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // Long hex strings (>= 24 chars) e.g. API keys, hashes, tokens.
  /^[a-f0-9]{24,}$/i,
  // Long base64 strings (>= 24 chars).
  /^[A-Za-z0-9+/]{24,}={0,2}$/,
  // JWT-like tokens.
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  // Bearer tokens.
  /^Bearer\s+\S+$/i,
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase());
}

function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

/**
 * Redact a single value. Returns the redacted marker if the value is a string
 * that looks like a secret, otherwise returns the value unchanged.
 */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string' && looksLikeSecret(value)) {
    return REDACTED;
  }
  return value;
}

/**
 * Deep-redact an object/array/primitive. Values under sensitive keys are
 * always redacted. Other string values are redacted only if they look like a
 * secret. The original object is not mutated.
 */
export function redactObject(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item));
  }

  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactObject(value);
      }
    }
    return out;
  }

  return redactValue(input);
}

export { REDACTED };
