const mongoose = require('mongoose');

const inventoryMovementSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    quantityDelta: { type: Number, required: true, validate: Number.isInteger },
    type: { type: String, enum: ['INITIAL', 'RESTOCK', 'ORDER', 'CANCELLATION', 'RETURN', 'ADJUSTMENT'], required: true },
    reason: { type: String, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 160 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestId: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true }
);
inventoryMovementSchema.index({ product: 1, createdAt: -1 });
module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);
