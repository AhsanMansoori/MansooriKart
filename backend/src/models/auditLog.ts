import { model, models, Schema, type Model } from 'mongoose';
const schema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
    requestId: String,
  },
  { timestamps: true, collection: 'auditlogs' }
);
export const AuditLog: any = (models.AuditLog as Model<any>) || model('AuditLog', schema);
