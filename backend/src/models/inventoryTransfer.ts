import { Schema, model, models, type Model } from 'mongoose';

const inventoryTransferSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    sourceWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    sourceLocation: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true },
    destinationWarehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    destinationLocation: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 128, unique: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestId: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true, collection: 'inventorytransfers' }
);
export const InventoryTransfer: any = (models.InventoryTransfer as Model<any>) || model('InventoryTransfer', inventoryTransferSchema);
