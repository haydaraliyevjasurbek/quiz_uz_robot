const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminTelegramId: { type: Number, required: true, index: true },
    action: { type: String, required: true, index: true },
    target: { type: String, default: '' },
    meta: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
