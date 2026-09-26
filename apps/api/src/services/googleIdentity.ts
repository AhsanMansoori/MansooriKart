import { OAuth2Client } from 'google-auth-library';
import { getConfig } from '../config/env.js';

/**
 * Google Identity Services credential verification.
 *
 * MansooriKart uses the smallest Google flow that exists: the browser renders Google's
 * own sign-in button, Google hands the browser a signed **ID token**, and the browser
 * posts that single string to `POST /api/v1/auth/google`. There is no authorisation-code
 * exchange, no redirect URI to register, no refresh token to store and therefore **no
 * client secret** — only the public client id, which is the token's audience.
 *
 * Signature verification is delegated to Google's own `google-auth-library`
 * (`OAuth2Client.verifyIdToken`), which fetches and caches Google's public certificates
 * and validates the signature, the audience and the expiry. Nothing here re-implements
 * JWT signature checking. On top of the library's guarantees this module re-asserts the
 * claims the application depends on — issuer, audience, subject, verified email, expiry —
 * so those rules are enforced by code this repository owns and tests, rather than being
 * assumed of a dependency.
 *
 * The network-dependent step is isolated behind `GoogleTokenDecoder` so the automated
 * suite can drive every claim-validation branch without contacting Google (§12).
 */

/** Claims this application reads from a Google ID token. Anything else is ignored. */
export interface GoogleTokenClaims {
  iss?: string | undefined;
  aud?: string | string[] | undefined;
  sub?: string | undefined;
  email?: string | undefined;
  email_verified?: boolean | string | undefined;
  exp?: number | undefined;
  name?: string | undefined;
  picture?: string | undefined;
}

/** The verified identity, reduced to what account resolution needs. */
export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export type GoogleIdentityErrorCode = 'GOOGLE_AUTH_UNAVAILABLE' | 'GOOGLE_TOKEN_INVALID' | 'GOOGLE_EMAIL_UNVERIFIED';

export class GoogleIdentityError extends Error {
  constructor(
    readonly code: GoogleIdentityErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GoogleIdentityError';
  }
}

/** Verifies the token's signature and returns its claims, or `null` when it carries none. */
export type GoogleTokenDecoder = (credential: string, audience: string) => Promise<GoogleTokenClaims | null>;

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** A Google ID token is a compact JWS; anything else is refused before a network call. */
const CREDENTIAL_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_CREDENTIAL_LENGTH = 4096;

let client: OAuth2Client | null = null;

/** Production decoder: Google's library, with Google's certificates. */
const googleLibraryDecoder: GoogleTokenDecoder = async (credential, audience) => {
  client ??= new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  return (ticket.getPayload() ?? null) as GoogleTokenClaims | null;
};

let decoder: GoogleTokenDecoder = googleLibraryDecoder;

/** Test seam. Production code never calls this; the suite injects a deterministic decoder. */
export function setGoogleTokenDecoder(next: GoogleTokenDecoder): void {
  decoder = next;
}
export function resetGoogleTokenDecoder(): void {
  decoder = googleLibraryDecoder;
}

/** `true` when the deployment is configured for Google sign-in at all. */
export function isGoogleSignInConfigured(): boolean {
  return Boolean(getConfig().googleClientId);
}

const audienceMatches = (aud: GoogleTokenClaims['aud'], expected: string): boolean => (Array.isArray(aud) ? aud.includes(expected) : aud === expected);

/**
 * Verifies a Google ID token and returns the identity it asserts.
 *
 * Every failure surfaces as a `GoogleIdentityError` with a fixed, safe message. Library
 * errors are swallowed deliberately: a Google verification failure must not leak token
 * internals, certificate URLs or stack traces into an API response (§11, §32).
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const audience = getConfig().googleClientId;
  if (!audience) throw new GoogleIdentityError('GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is not enabled for this deployment.');
  if (!credential || credential.length > MAX_CREDENTIAL_LENGTH || !CREDENTIAL_SHAPE.test(credential))
    throw new GoogleIdentityError('GOOGLE_TOKEN_INVALID', 'Google sign-in could not be verified.');

  let claims: GoogleTokenClaims | null;
  try {
    claims = await decoder(credential, audience);
  } catch {
    throw new GoogleIdentityError('GOOGLE_TOKEN_INVALID', 'Google sign-in could not be verified.');
  }

  const invalid = new GoogleIdentityError('GOOGLE_TOKEN_INVALID', 'Google sign-in could not be verified.');
  if (!claims || typeof claims !== 'object') throw invalid;
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) throw invalid;
  if (!audienceMatches(claims.aud, audience)) throw invalid;
  if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 255) throw invalid;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw invalid;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid;
  // An unverified Google email proves control of a Google account, not of the mailbox, so
  // it can neither create nor be matched against a MansooriKart account (§8).
  if (claims.email_verified !== true && claims.email_verified !== 'true')
    throw new GoogleIdentityError('GOOGLE_EMAIL_UNVERIFIED', 'This Google account does not have a verified email address.');

  const name = typeof claims.name === 'string' ? claims.name.trim().slice(0, 120) : '';
  const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 2048) : '';
  return { subject: claims.sub, email, name: name || null, picture: picture || null };
}
