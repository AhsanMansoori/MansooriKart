import { Schema, model, models, type Model } from 'mongoose';

/**
 * Immutable record of a physical delivery against a purchase order. Only
 * `quantityAccepted` ever reaches inventory; rejected units are recorded for
 * supplier quality reporting and never become sellable stock.
 */
const goodsReceiptItemSchema = new Schema(
  {
    purchaseOrderItem: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, trim: true, maxlength: 300 },
    sku: { type: String, trim: true, uppercase: true },
    unitCost: { type: Number, required: true, min: 0 },
    quantityAccepted: { type: Number, required: true, min: 0 },
    quantityRejected: { type: Number, required: true, min: 0, default: 0 },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    previousCostPrice: { type: Number, min: 0 },
  },
  { _id: false }
);

const goodsReceiptSchema = new Schema(
  {
    receiptNumber: { type: String, required: true, unique: true, index: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    location: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true },
    items: { type: [goodsReceiptItemSchema], default: [] },
    totalAccepted: { type: Number, required: true, min: 0, default: 0 },
    totalRejected: { type: Number, required: true, min: 0, default: 0 },
    acceptedValue: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    receivedAt: { type: Date, default: Date.now, index: true },
    note: { type: String, trim: true, maxlength: 2000 },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String, required: true },
    costPriceSynced: { type: Boolean, default: false },
    requestId: { type: String },
  },
  { timestamps: true, collection: 'goodsreceipts' }
);
goodsReceiptSchema.index({ purchaseOrder: 1, idempotencyKey: 1 }, { unique: true });
goodsReceiptSchema.index({ createdAt: -1 });
export const GoodsReceipt: any = (models.GoodsReceipt as Model<any>) || model('GoodsReceipt', goodsReceiptSchema);

/**
 * Return of previously accepted goods to a supplier. This is the exact inverse
 * of a receipt for inventory purposes and is capped by the accepted quantity
 * that has not already been returned. No financial settlement is implied.
 */
const purchaseReturnItemSchema = new Schema(
  {
    purchaseOrderItem: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, trim: true, maxlength: 300 },
    sku: { type: String, trim: true, uppercase: true },
    unitCost: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const purchaseReturnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true, index: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    location: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true },
    items: { type: [purchaseReturnItemSchema], default: [] },
    totalQuantity: { type: Number, required: true, min: 0, default: 0 },
    returnedValue: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    returnedAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String, required: true },
    requestId: { type: String },
  },
  { timestamps: true, collection: 'purchasereturns' }
);
purchaseReturnSchema.index({ purchaseOrder: 1, idempotencyKey: 1 }, { unique: true });
purchaseReturnSchema.index({ createdAt: -1 });
export const PurchaseReturn: any = (models.PurchaseReturn as Model<any>) || model('PurchaseReturn', purchaseReturnSchema);
