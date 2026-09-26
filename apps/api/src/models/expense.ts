import { Schema, model, models, type Model } from 'mongoose';

/**
 * Operating expense record. This is a deliberately small bookkeeping document,
 * not an accounts-payable subledger: there is no vendor balance, no invoice
 * matching, no aging bucket, no payment scheduling and no double-entry posting.
 *
 * There is deliberately no salary or payroll category. MansooriKart has no
 * payroll module: no employee records, no payslips, no withholding and no
 * statutory contribution handling exist anywhere in the system, so offering a
 * payroll-shaped category would imply a capability that does not exist.
 */
export const EXPENSE_CATEGORIES = [
  'SHIPPING',
  'WAREHOUSING',
  'MARKETING',
  'SOFTWARE',
  'UTILITIES',
  'OFFICE',
  'RENT',
  'PACKAGING',
  'EQUIPMENT',
  'MAINTENANCE',
  'PROFESSIONAL_FEES',
  'BANK_CHARGES',
  'TAXES_AND_LICENSES',
  'TRAVEL',
  'MISCELLANEOUS',
] as const;

/**
 * Descriptive record of how the money left the business. This is not a gateway
 * instruction and no external provider is contacted: nothing here moves money.
 */
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] as const;

const history = new Schema(
  {
    from: { type: String, default: null },
    to: { type: String, required: true },
    reason: { type: String, default: null },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    requestId: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const expenseSchema = new Schema(
  {
    // Server-generated `EXP-YYYYMMDD-XXXXXX`. Never client-controlled.
    expenseNumber: { type: String, required: true, unique: true, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    // Net amount excluding tax. Immutable once APPROVED: corrections are made by
    // voiding the record and creating a replacement, never by rewriting history.
    amount: { type: Number, required: true, min: 0.01 },
    taxAmount: { type: Number, min: 0, default: 0 },
    // Server-derived (`amount + taxAmount`). Never client-controlled.
    totalAmount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    expenseDate: { type: Date, required: true, index: true },
    paymentMethod: { type: String, enum: EXPENSE_PAYMENT_METHODS, default: 'CASH' },
    // Optional operational link to a known counterparty. A supplier link never
    // turns this record into a purchase order, a payable, or a goods receipt.
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    // Optional cross-reference to the purchase order this expense relates to, for
    // operator traceability only. It does NOT make the purchase order an expense
    // and does not settle, close or pay it: purchase commitments and accounting
    // expenses are separate facts and are never derived from one another.
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null, index: true },
    reference: { type: String, trim: true, maxlength: 120, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },
    // Only APPROVED expenses are realized operating expenses. DRAFT and VOIDED
    // records are excluded from every finance and reporting total.
    status: { type: String, enum: ['DRAFT', 'APPROVED', 'VOIDED'], default: 'DRAFT' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, trim: true, maxlength: 500, default: null },
    statusHistory: { type: [history], default: [] },
  },
  { timestamps: true, collection: 'expenses' }
);

// Reporting reads are always bounded by date and usually narrowed by status or
// category, so these two compound indexes cover the finance and report queries.
// `status` and `category` are deliberately not indexed on their own: each is the
// prefix of a compound index below, so a separate single-field index would only
// add write cost.
expenseSchema.index({ status: 1, expenseDate: -1 });
expenseSchema.index({ category: 1, expenseDate: -1 });

export const Expense: any = (models.Expense as Model<any>) || model('Expense', expenseSchema);
