import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['CUSTOMER', 'SUPER_ADMIN'], default: 'CUSTOMER', required: true },
    phone: { type: String, trim: true, maxlength: 30 },
    avatar: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true, collection: 'users' }
);
// Customer registration reporting counts by role inside a date window, and the
// customers ERP lists customers newest-first, so role must lead the index.
userSchema.index({ role: 1, createdAt: -1 });
export type UserDocument = InferSchemaType<typeof userSchema>;
export const User: any = (models.User as Model<any>) || model('User', userSchema);
