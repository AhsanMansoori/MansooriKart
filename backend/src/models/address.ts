import { Schema, model, models, type Model } from 'mongoose';

const addressSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true, maxlength: 50, default: 'Address' },
    fullName: { type: String, trim: true, required: true, maxlength: 120 },
    phone: { type: String, trim: true, required: true, maxlength: 30 },
    addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, required: true, maxlength: 100 },
    stateProvince: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 30 },
    country: { type: String, trim: true, required: true, maxlength: 100 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'addresses' }
);
addressSchema.index({ user: 1, isDefault: 1 });
export const Address: any = (models.Address as Model<any>) || model('Address', addressSchema);
