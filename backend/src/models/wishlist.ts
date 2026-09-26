import { model, models, Schema, type Model } from 'mongoose';

const wishlistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  },
  { timestamps: true, collection: 'wishlists' }
);
export const Wishlist: any = (models.Wishlist as Model<any>) || model('Wishlist', wishlistSchema);
