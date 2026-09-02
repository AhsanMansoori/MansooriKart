const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, trim: true, index: true },
    resourceType: { type: String, required: true, trim: true, index: true },
    resourceId: { type: String, trim: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestId: { type: String, trim: true, index: true },
  },
  { timestamps: true }
);
auditLogSchema.index({ createdAt: -1 });
module.exports = mongoose.model('AuditLog', auditLogSchema);
