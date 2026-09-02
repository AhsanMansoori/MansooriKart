import { model, models, Schema, type Model } from 'mongoose';

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: {
      type: [{ product: { type: Schema.Types.ObjectId, ref: 'Product', required: true }, quantity: { type: Number, required: true, min: 1, max: 99 } }],
      default: [],
    },
  },
  { timestamps: true, collection: 'carts' }
);
export const Cart: any = (models.Cart as Model<any>) || model('Cart', cartSchema);
