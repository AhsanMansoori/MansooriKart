import { Schema, model, models, type Model } from 'mongoose';

/**
 * A supplier's shipment obligation for part of one customer order.
 *
 * This is deliberately *not* PurchaseOrder/GoodsReceipt. Those two move
 * MansooriKart-owned inventory into a warehouse; a `DropshipFulfillment` records a
 * supplier shipping directly to a customer, so nothing touches InventoryBalance or
 * InventoryMovement. See DROPSHIPPING_ARCHITECTURE.md §"Two distinct workflows".
 *
 * One order can produce several of these — one per supplier — which is why the
 * document holds `orderItems` (indices into `Order.items`) rather than living on the
 * order itself. A mixed order with own-stock lines and two suppliers' lines yields
 * two fulfillments and leaves the own-stock lines to the existing warehouse flow.
 *
 * `supplierOrderReference` is whatever the supplier calls the job on their side. It
 * is informational: MansooriKart order identity remains `Order.orderNumber`, and
 * nothing keys off the supplier's string.
 *
 * Status here is the *supplier-side* lifecycle and is independent of
 * `Order.orderStatus`, which remains the customer-facing workflow. Advancing a
 * fulfillment records what MansooriKart believes and knows; it never claims a side
 * effect at the supplier that MansooriKart did not actually perform.
 */
const dropshipFulfillmentSchema = new Schema(
  {
    fulfillmentNumber: { type: String, required: true, unique: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'V1Order', required: true, index: true },
    /** Snapshot of the order number, so listings need no join to stay readable. */
    orderNumber: { type: String, required: true },
    /** Zero-based indices of the `Order.items` entries this supplier ships. */
    orderItems: { type: [Number], default: [] },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    supplierOrderReference: { type: String, trim: true, maxlength: 160 },
    supplierTrackingNumber: { type: String, trim: true, maxlength: 160 },
    carrier: { type: String, trim: true, maxlength: 120 },
    trackingUrl: { type: String, trim: true, maxlength: 500 },
    sentToSupplierAt: { type: Date },
    confirmedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    failedAt: { type: Date },
    cancelledAt: { type: Date },
    /** Internal operator notes. Never exposed to a customer-facing serializer. */
    notes: { type: String, trim: true, maxlength: 2000 },
    /** Audit trail of supplier-side transitions, mirroring the Order.statusHistory shape. */
    statusHistory: {
      type: [
        { from: String, to: String, reason: String, actor: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, _id: false },
      ],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'dropshipfulfillments' }
);
// Admin listing is filtered by supplier and/or status and always ordered by date;
// `order` alone already serves the per-order lookup declared on the field above.
dropshipFulfillmentSchema.index({ supplier: 1, status: 1, createdAt: -1 });
dropshipFulfillmentSchema.index({ status: 1, createdAt: -1 });
// Checkout creates at most one fulfillment per supplier per order, and retries must
// find the existing one instead of adding a second.
dropshipFulfillmentSchema.index({ order: 1, supplier: 1 }, { unique: true });
export const DropshipFulfillment: any = (models.DropshipFulfillment as Model<any>) || model('DropshipFulfillment', dropshipFulfillmentSchema);
