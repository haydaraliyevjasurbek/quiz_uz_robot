const AdminAuditLog = require('../models/AdminAuditLog');

async function logAdminAction(ctx, action, target, meta) {
  const adminTelegramId = ctx?.from?.id;
  if (!adminTelegramId) return;

  await AdminAuditLog.create({
    adminTelegramId,
    action: String(action || ''),
    target: target ? String(target) : '',
    meta: meta && typeof meta === 'object' ? meta : {}
  });
}

async function listAuditLogs(limit) {
  const lim = Math.max(1, Math.min(Number(limit || 50), 200));
  return AdminAuditLog.find({}, { adminTelegramId: 1, action: 1, target: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(lim)
    .lean();
}

module.exports = { logAdminAction, listAuditLogs };
