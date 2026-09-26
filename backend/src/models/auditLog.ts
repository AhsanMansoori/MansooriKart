import { model, models, Schema, type Model } from 'mongoose';
/**
 * The single audit authority. Records are append-only: nothing in the API updates or
 * deletes one, and the Super Admin surface over them is read-only by construction.
 */
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
/**
 * Indexes shaped to the four ways the Super Admin trail is actually read: newest
 * first, by action, by the resource that changed, and by who changed it. Each is a
 * compound ending in `createdAt` because every one of those reads is also sorted by
 * time, so none of them is redundant with the others.
 */
schema.index({ createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });
schema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
schema.index({ actor: 1, createdAt: -1 });
export const AuditLog: any = (models.AuditLog as Model<any>) || model('AuditLog', schema);
