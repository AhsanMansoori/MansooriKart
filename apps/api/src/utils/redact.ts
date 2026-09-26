/**
 * Audit-metadata redaction.
 *
 * Audit entries are written by many call sites and their `metadata` is deliberately
 * `Mixed`, so the read API cannot assume the shape of what it is about to publish.
 * Rather than trusting every writer to have been careful, the Super Admin read path
 * redacts on the way out: any key whose name matches a sensitive concept is replaced
 * with a marker, oversized strings are truncated, and the structure is bounded in both
 * depth and breadth so one pathological entry cannot dominate a page of results.
 *
 * This is defence in depth, not the only defence — writers still avoid recording
 * secrets. Redaction guarantees that a future writer's mistake cannot become a leak
 * through this endpoint (§42).
 */

/**
 * Key names that must never be published, matched case-insensitively as substrings.
 *
 * Substring matching is intentional: it catches `smtpPassword`, `x-api-key`,
 * `refreshToken` and `supplierCredential` without needing an exhaustive list of exact
 * names. `csv` and `raw` are included because a raw uploaded feed body is both large
 * and potentially confidential supplier data.
 */
const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|jwt|authorization|cookie|apikey|api_key|api-key|credential|smtp|mongo|connectionstring|privatekey|signature|sessionid|otp|hash|salt|rawcsv|csvbody|filebody|env/i;
const REDACTED = '[REDACTED]';
const MAX_STRING = 512;
const MAX_KEYS = 40;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

const truncate = (value: string): string => (value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);

/**
 * Returns a publication-safe copy of an audit metadata value.
 *
 * Anything past the depth, key-count or array bounds is summarised rather than
 * dropped silently, so an operator can tell that content existed without receiving it.
 */
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map(entry => redactMetadata(entry, depth + 1));
    return value.length > MAX_ARRAY ? [...items, `[${value.length - MAX_ARRAY} more]`] : items;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, entry] of entries.slice(0, MAX_KEYS)) output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactMetadata(entry, depth + 1);
    if (entries.length > MAX_KEYS) output['[truncated]'] = `${entries.length - MAX_KEYS} more keys`;
    return output;
  }
  return REDACTED;
}

/** Redacted metadata object for one audit entry. Always an object, never `undefined`. */
export function redactAuditMetadata(metadata: unknown): Record<string, unknown> {
  const redacted = redactMetadata(metadata ?? {});
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? (redacted as Record<string, unknown>) : { value: redacted };
}
