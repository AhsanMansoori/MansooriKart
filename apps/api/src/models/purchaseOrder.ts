import { Schema, model, models, type Model } from 'mongoose';

/**
 * A purchase order line. `quantityOrdered` and `unitCost` are the commercial
 * commitment; `quantityReceived` / `quantityAccepted` / `quantityRejected` /
 * `quantityReturned` are receiving counters that are only ever moved by atomic
 * conditional updates in the purchasing service, never by a client payload.
 */
const purchaseOrderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    sku: { type: String, trim: true, uppercase: true },
    quantityOrdered: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    lineSubtotal: { type: Number, required: true, min: 0 },
    quantityReceived: { type: Number, default: 0, min: 0 },
    quantityAccepted: { type: Number, default: 0, min: 0 },
    quantityRejected: { type: Number, default: 0, min: 0 },
    quantityReturned: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const statusHistorySchema = new Schema(
  {
    from: { type: String },
    to: { type: String, required: true },
    reason: { type: String, trim: true, maxlength: 500 },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    requestId: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const purchaseOrderSchema = new Schema(
  {
    poNumber: { type: String, required: true, unique: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    location: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },
    items: { type: [purchaseOrderItemSchema], default: [] },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    shippingCost: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    discount: { type: Number, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    expectedDate: { type: Date },
    reference: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 2000 },
    statusHistory: { type: [statusHistorySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    cancelledAt: { type: Date },
    closedAt: { type: Date },
    firstReceivedAt: { type: Date },
    lastReceivedAt: { type: Date },
  },
  { timestamps: true, collection: 'purchaseorders' }
);
purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ supplier: 1, createdAt: -1 });
purchaseOrderSchema.index({ 'items.product': 1 });
export const PurchaseOrder: any = (models.PurchaseOrder as Model<any>) || model('PurchaseOrder', purchaseOrderSchema);
