import { AuditLog } from '../models/auditLog.js';
import { User } from '../models/user.js';
import { GoogleIdentityError, verifyGoogleCredential, type GoogleIdentity } from './googleIdentity.js';

/**
 * Google account resolution: the one place that decides which MansooriKart user a verified
 * Google identity corresponds to.
 *
 * The policy is deliberately explicit rather than emergent, because "sign in with Google"
 * is an account-takeover primitive if it guesses. Six cases, all enumerated below and all
 * covered by `tests/auth-google.integration.test.ts`:
 *
 *  A. Unknown Google subject, unknown email  -> create a CUSTOMER with no password.
 *  B. Known Google subject                   -> sign that account in; nothing is modified.
 *  C. Unknown subject, existing local account
 *     with the same *verified* email         -> link the subject to that account.
 *  D. Unknown subject, existing account
 *     already linked to a different subject  -> refuse. Two Google identities may not
 *                                               share one MansooriKart account.
 *  E. Account not ACTIVE                     -> refuse. Google is an entry point, not a
 *                                               way around a suspension.
 *  F. Account is not a CUSTOMER              -> refuse. Administrative access is local
 *                                               credentials only, so Google can neither
 *                                               grant nor reach SUPER_ADMIN, and an
 *                                               existing Super Admin is never silently
 *                                               linked or modified (§9).
 *
 * Role is never read from the request or from Google's claims: a created account is
 * `CUSTOMER` because this file writes that literal, and an existing account's role is left
 * exactly as it was.
 */

export type GoogleAuthOutcome = 'CREATED' | 'LINKED' | 'RETURNING';

export type GoogleAuthErrorCode =
  | 'GOOGLE_AUTH_UNAVAILABLE'
  | 'GOOGLE_TOKEN_INVALID'
  | 'GOOGLE_EMAIL_UNVERIFIED'
  | 'GOOGLE_SIGN_IN_NOT_PERMITTED'
  | 'AUTH_ACCOUNT_SUSPENDED'
  | 'GOOGLE_ACCOUNT_CONFLICT';

export class GoogleAuthError extends Error {
  constructor(
    readonly code: GoogleAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export interface GoogleAuthResult {
  user: Record<string, any>;
  outcome: GoogleAuthOutcome;
}

const CONFLICT = () =>
  new GoogleAuthError('GOOGLE_ACCOUNT_CONFLICT', 'This email address is already linked to a different Google account. Sign in with your password instead.');
const NOT_PERMITTED = () => new GoogleAuthError('GOOGLE_SIGN_IN_NOT_PERMITTED', 'This account must sign in with its MansooriKart password.');
const SUSPENDED = () => new GoogleAuthError('AUTH_ACCOUNT_SUSPENDED', 'This account is suspended. Contact support for assistance.');

/** Cases E and F, applied to every account Google resolves to — new, linked or returning. */
function assertEligible(candidate: { role?: string; status?: string }): void {
  if (candidate.role !== 'CUSTOMER') throw NOT_PERMITTED();
  if (candidate.status !== 'ACTIVE') throw SUSPENDED();
}

function audit(user: Record<string, any>, action: 'AUTH_GOOGLE_ACCOUNT_CREATED' | 'AUTH_GOOGLE_ACCOUNT_LINKED', requestId?: string): void {
  // Metadata records that a link happened, never the credential, the Google subject or
  // any token material (§33). Returning sign-ins are not audited: they would grow the
  // trail without recording a change.
  void AuditLog.create({
    actor: user['_id'],
    action,
    resourceType: 'User',
    resourceId: String(user['_id']),
    metadata: { provider: 'GOOGLE' },
    ...(requestId ? { requestId } : {}),
  }).catch(() => undefined);
}

/** Case C, made concurrency-safe: the link only applies to an account that is still unlinked. */
async function linkExisting(existing: Record<string, any>, identity: GoogleIdentity, requestId?: string): Promise<GoogleAuthResult> {
  if (typeof existing['googleId'] === 'string' && existing['googleId'] !== identity.subject) throw CONFLICT();
  if (existing['googleId'] === identity.subject) return { user: existing, outcome: 'RETURNING' };

  const linked = await User.findOneAndUpdate(
    { _id: existing['_id'], role: 'CUSTOMER', status: 'ACTIVE', $or: [{ googleId: { $exists: false } }, { googleId: null }] },
    { $set: { googleId: identity.subject }, $addToSet: { authProviders: 'GOOGLE' } },
    { new: true }
  )
    .select('+sessionVersion')
    .lean();

  if (linked) {
    audit(linked, 'AUTH_GOOGLE_ACCOUNT_LINKED', requestId);
    return { user: linked, outcome: 'LINKED' };
  }
  // Lost the race, or the account stopped being eligible between the read and the write.
  const current = await User.findById(existing['_id']).select('+sessionVersion').lean();
  if (!current) throw CONFLICT();
  assertEligible(current);
  if (current['googleId'] !== identity.subject) throw CONFLICT();
  return { user: current, outcome: 'RETURNING' };
}

/** Case A. A duplicate-key failure means a concurrent first sign-in already created it. */
async function createCustomer(identity: GoogleIdentity, requestId?: string): Promise<GoogleAuthResult> {
  try {
    const created = await User.create({
      name: identity.name || identity.email.split('@')[0],
      email: identity.email,
      googleId: identity.subject,
      authProviders: ['GOOGLE'],
      role: 'CUSTOMER',
      status: 'ACTIVE',
      ...(identity.picture ? { avatar: identity.picture } : {}),
    });
    const user = created.toObject();
    audit(user, 'AUTH_GOOGLE_ACCOUNT_CREATED', requestId);
    return { user, outcome: 'CREATED' };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = await User.findOne({ googleId: identity.subject }).select('+sessionVersion').lean();
    if (!winner) throw CONFLICT();
    assertEligible(winner);
    return { user: winner, outcome: 'RETURNING' };
  }
}

/**
 * Verifies a Google credential and returns the MansooriKart account it belongs to.
 *
 * Callers receive a user document and an outcome; issuing the application's own JWT is the
 * route's job, so this service has no opinion about tokens or transport.
 */
export async function authenticateWithGoogle(credential: string, requestId?: string): Promise<GoogleAuthResult> {
  let identity: GoogleIdentity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (error) {
    if (error instanceof GoogleIdentityError) throw new GoogleAuthError(error.code, error.message);
    throw error;
  }

  const bySubject = await User.findOne({ googleId: identity.subject }).select('+sessionVersion').lean();
  if (bySubject) {
    assertEligible(bySubject);
    return { user: bySubject, outcome: 'RETURNING' };
  }

  const byEmail = await User.findOne({ email: identity.email }).select('+sessionVersion').lean();
  if (byEmail) {
    assertEligible(byEmail);
    return linkExisting(byEmail, identity, requestId);
  }

  return createCustomer(identity, requestId);
}
