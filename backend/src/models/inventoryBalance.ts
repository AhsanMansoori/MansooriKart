import { Schema, model, models, type Model } from 'mongoose';

const inventoryBalanceSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    location: { type: Schema.Types.ObjectId, ref: 'StockLocation', required: true, index: true },
    quantityOnHand: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
    quantityReserved: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  },
  { timestamps: true, collection: 'inventorybalances' }
);

inventoryBalanceSchema.index({ product: 1, warehouse: 1, location: 1 }, { unique: true });

export const InventoryBalance: any = (models.InventoryBalance as Model<any>) || model('InventoryBalance', inventoryBalanceSchema);
