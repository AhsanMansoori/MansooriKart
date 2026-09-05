/**
 * Content and URL safety helpers shared by every marketing, CMS and settings route.
 *
 * MansooriKart never stores operator-supplied HTML. Rich content is a closed set of
 * structured blocks (see `config/storefront.ts`) whose text fields pass through
 * `stripMarkup` on the way in, so a `<script>` tag, an inline event handler or an
 * `onerror=` attribute cannot survive persistence — there is nothing to sanitise at
 * render time because there is no markup to render. Links are validated by scheme
 * rather than by blocklist: `http:` and `https:` are accepted and everything else,
 * including `javascript:`, `data:`, `file:` and `vbscript:`, is refused.
 *
 * Nothing here fetches a URL. Validation is purely structural; the server never
 * dereferences an operator-supplied address.
 */

import { ALLOWED_URL_SCHEMES, CONTENT_LIMITS } from '../config/storefront.js';

/** Escapes a string for safe use inside a MongoDB regular-expression filter. */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes every trace of markup from operator-supplied text.
 *
 * Script and style elements are dropped with their contents (so `<script>alert(1)`
 * does not leave `alert(1)` behind as visible text), all remaining tags are removed,
 * HTML entities that could re-introduce a bracket are neutralised, and control
 * characters are stripped. The result is plain text that a client must render as
 * text; see `docs/CMS_ARCHITECTURE.md`.
 *
 * Line breaks collapse to spaces alongside tabs, so every stored value is single-line.
 * A meta title is rendered into a tag and a support address can be echoed into a mail
 * header, and a stray CR or LF is what turns either of those into an injection point
 * (§25) — one field, one line, no exception.
 */
export function stripMarkup(value: string): string {
  return value
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:lt|gt|#0*60|#0*62|#x0*3c|#x0*3e);/gi, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** `true` when the text carries no markup and no scheme-bearing hostile prefix. */
export function isPlainText(value: string): boolean {
  return !/[<>]/.test(value) && !/\b(?:javascript|data|vbscript|file)\s*:/i.test(value) && !/\bon[a-z]+\s*=/i.test(value);
}

/**
 * Validates an absolute URL and returns its normalised form, or `null`.
 *
 * Only `http:` and `https:` pass. A URL without a host, or longer than the central
 * bound, is rejected so a settings write cannot smuggle an oversized string into a
 * public payload.
 */
export function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CONTENT_LIMITS.maxUrlLength) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol) || !parsed.hostname) return null;
  return parsed.toString();
}

/**
 * Validates a storefront-relative path such as `/shop` or `/pages/returns`.
 *
 * A leading slash is required and `//host` is refused, because a protocol-relative
 * value is an off-site redirect wearing an internal path's clothes. Backslashes,
 * markup characters and scheme separators are all refused.
 */
export function safeInternalPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.length > CONTENT_LIMITS.maxUrlLength) return null;
  if (/[<>"'\\]/.test(trimmed) || trimmed.includes(':') || trimmed.includes('..')) return null;
  return trimmed;
}

/**
 * Normalises a slug to lowercase `a-z0-9-`.
 *
 * Returns `null` when nothing usable survives, which is how a title of pure
 * punctuation is rejected instead of silently becoming an empty slug.
 */
export function slugify(value: string): string | null {
  const slug = stripMarkup(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CONTENT_LIMITS.maxSlugLength)
    .replace(/-+$/g, '');
  return slug || null;
}

/** `true` when the value is already a well-formed slug. */
export const isSlug = (value: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= CONTENT_LIMITS.maxSlugLength;

/** Normalises a coupon code: uppercase, trimmed, internal whitespace removed. */
export const normalizeCouponCode = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

/**
 * `true` when a 24-character hex string could be a Mongo ObjectId.
 *
 * Routes test identifiers with this before querying so a malformed id becomes a
 * clean 404 instead of a CastError that would surface a driver stack trace.
 */
export const isObjectId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
