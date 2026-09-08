import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

/**
 * The single user authority.
 *
 * Local credentials and Google identities both resolve to a document in this collection;
 * there is no second user store and no separate Google collection. After sign-in the
 * application's own JWT is the only thing authorisation reads, so a Google identity is an
 * *entry point*, never a source of privilege. See `docs/AUTHENTICATION_ARCHITECTURE.md`.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    // Required unless the account is reachable through a Google identity. This is the
    // schema-level statement of "every account must have at least one usable credential":
    // a Google-only customer legitimately has no password hash, and a local account
    // cannot be created without one.
    password: {
      type: String,
      select: false,
      required: function (this: { googleId?: string | null }) {
        return !this.googleId;
      },
    },
    /**
     * Google's stable subject identifier (`sub`) for a linked account.
     *
     * The subject, not the email address, is the identity key: an email can be changed or
     * reassigned, a subject cannot. Absent on local-only accounts. No Google ID token,
     * access token or refresh token is ever stored (§7).
     */
    googleId: { type: String, trim: true, maxlength: 255 },
    /** Descriptive record of how this account can sign in. Never consulted for authorisation. */
    authProviders: { type: [{ type: String, enum: ['LOCAL', 'GOOGLE'] }], default: ['LOCAL'] },
    role: { type: String, enum: ['CUSTOMER', 'SUPER_ADMIN'], default: 'CUSTOMER', required: true },
    phone: { type: String, trim: true, maxlength: 30 },
    avatar: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
    sessionVersion: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true, collection: 'users' }
);
// Customer registration reporting counts by role inside a date window, and the
// customers ERP lists customers newest-first, so role must lead the index.
userSchema.index({ role: 1, createdAt: -1 });
/**
 * One MansooriKart account per Google subject, enforced by the database.
 *
 * A partial index rather than a sparse one: `sparse` skips only missing fields and would
 * still treat two explicit `null`s as a collision, so a future write that sets
 * `googleId: null` could not fail closed. `$type: 'string'` indexes exactly the linked
 * accounts. `User.init()` runs at startup (see `src/server.ts`) because a uniqueness
 * invariant must exist before the first write, not eventually.
 */
userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });
export type UserDocument = InferSchemaType<typeof userSchema>;
export const User: any = (models.User as Model<any>) || model('User', userSchema);
