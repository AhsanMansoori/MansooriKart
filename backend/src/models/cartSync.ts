import { Schema, model, models } from 'mongoose';

const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    fingerprint: { type: String, required: true },
  },
  { timestamps: true, collection: 'cartsyncs' }
);
schema.index({ user: 1, key: 1 }, { unique: true });
export const CartSync: any = models.CartSync || model('CartSync', schema);
