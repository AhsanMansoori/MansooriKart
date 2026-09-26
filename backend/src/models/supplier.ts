import { Schema, model, models, type Model } from 'mongoose';

/**
 * Procurement counterparty. Suppliers are an operational contact record only:
 * there is deliberately no login, no portal account, and no banking credential
 * storage. Payment terms are descriptive text, not a settlement instruction.
 */
const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    contactName: { type: String, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, index: true },
    phone: { type: String, trim: true, maxlength: 40 },
    addressLine1: { type: String, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 120 },
    state: { type: String, trim: true, maxlength: 120 },
    postalCode: { type: String, trim: true, maxlength: 30 },
    country: { type: String, trim: true, maxlength: 120 },
    taxId: { type: String, trim: true, maxlength: 60 },
    paymentTerms: { type: String, enum: ['PREPAID', 'COD', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60'], default: 'NET_30' },
    leadTimeDays: { type: Number, min: 0, max: 365 },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    notes: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'suppliers' }
);
supplierSchema.index({ name: 1 });
supplierSchema.index({ status: 1, createdAt: -1 });
export const Supplier: any = (models.Supplier as Model<any>) || model('Supplier', supplierSchema);
