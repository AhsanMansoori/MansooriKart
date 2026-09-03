import { model, models, Schema, type Model } from 'mongoose';

const item = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: String,
    sku: String,
    image: String,
    unitPrice: Number,
    quantity: Number,
    lineSubtotal: Number,
    // Immutable cost-of-goods snapshot taken from the product at order creation
    // using the LATEST_PURCHASE_COST basis. Later `Product.costPrice` changes
    // must never move historical profit, so cost is frozen here rather than
    // joined at report time. Absent on orders created before snapshots existed;
    // such lines contribute revenue but no cost, and finance responses report
    // that coverage explicitly instead of guessing a cost.
    unitCost: Number,
    lineCost: Number,
  },
  { _id: false }
);
const address = new Schema(
  { fullName: String, phone: String, addressLine1: String, addressLine2: String, city: String, stateProvince: String, postalCode: String, country: String },
  { _id: false }
);
const coupon = new Schema({ couponId: Schema.Types.ObjectId, code: String, type: String, value: Number, actualDiscount: Number }, { _id: false });
const history = new Schema(
  {
    status: String,
    from: String,
    to: String,
    reason: String,
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    requestId: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);
const orderSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    // Server-generated at creation and never mutated afterwards. Derived from the unique orderNumber,
    // so it is collision-safe without a separate Invoice collection. Never client-controlled.
    invoiceNumber: { type: String, index: true },
    idempotencyKey: { type: String, required: true },
    items: { type: [item], required: true },
    shippingAddress: { type: address, required: true },
    subtotal: Number,
    discount: Number,
    shipping: Number,
    tax: Number,
    total: Number,
    // Authoritative accumulator of non-FAILED refunded value. Guarded by an atomic conditional
    // $inc so concurrent refunds can never exceed `total`. Never client-controlled.
    refundedTotal: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'PKR' },
    coupon: { type: coupon },
    paymentMethod: { type: String, enum: ['CASH_ON_DELIVERY'], required: true },
    paymentStatus: { type: String, enum: ['PENDING', 'UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'], default: 'UNPAID' },
    orderStatus: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED'],
      default: 'PENDING',
      index: true,
    },
    statusHistory: { type: [history], default: [] },
  },
  { timestamps: true, collection: 'orders' }
);
orderSchema.index({ customer: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
// Finance and report aggregates window on `createdAt` alone; no existing index
// leads with it, so a date-bounded scan would otherwise read the collection.
orderSchema.index({ createdAt: -1 });
export const Order: any = (models.V1Order as Model<any>) || model('V1Order', orderSchema);
