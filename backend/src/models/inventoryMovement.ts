import { model, models, Schema, type Model } from 'mongoose';

const inventoryMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', index: true },
    location: { type: Schema.Types.ObjectId, ref: 'StockLocation', index: true },
    type: {
      type: String,
      enum: ['INITIAL', 'RESTOCK', 'ORDER', 'CANCELLATION', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN'],
      required: true,
    },
    quantityDelta: { type: Number, required: true, validate: Number.isInteger },
    previousStock: { type: Number, min: 0 },
    newStock: { type: Number, min: 0 },
    reason: { type: String, trim: true, maxlength: 500 },
    referenceType: { type: String, trim: true, maxlength: 80 },
    referenceId: { type: String, trim: true, maxlength: 160 },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    requestId: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true, collection: 'inventorymovements' }
);
inventoryMovementSchema.index({ product: 1, createdAt: -1 });
inventoryMovementSchema.index({ warehouse: 1, location: 1, createdAt: -1 });
export const InventoryMovement: any = (models.InventoryMovement as Model<any>) || model('InventoryMovement', inventoryMovementSchema);
