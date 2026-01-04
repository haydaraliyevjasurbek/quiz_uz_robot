const Admin = require('../models/Admin');

const ROLE_RANK = {
  moderator: 1,
  superadmin: 2
};

function parseEnvSuperadmins() {
  const raw = process.env.ADMIN_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

async function ensureSuperadminsFromEnv() {
  const ids = parseEnvSuperadmins();
  if (!ids.length) return;

  await Admin.updateMany(
    { telegramId: { $in: ids } },
    { $set: { role: 'superadmin' } },
    { upsert: false }
  );

  // Upsert har birini (updateMany upsert qilmaydi)
  await Promise.all(
    ids.map((telegramId) =>
      Admin.updateOne({ telegramId }, { $set: { role: 'superadmin' } }, { upsert: true })
    )
  );
}

async function getRole(telegramId) {
  const id = Number(telegramId);
  if (!Number.isFinite(id)) return null;

  // Env superadmin doim superadmin
  if (parseEnvSuperadmins().includes(id)) return 'superadmin';

  const admin = await Admin.findOne({ telegramId: id }, { role: 1 }).lean();
  return admin ? admin.role : null;
}

async function hasAtLeastRole(telegramId, minRole) {
  const role = await getRole(telegramId);
  if (!role) return false;
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minRole] || 0);
}

async function listAdmins() {
  return Admin.find({}, { telegramId: 1, role: 1 }).sort({ role: -1, telegramId: 1 }).lean();
}

async function upsertAdmin(telegramId, role) {
  const id = Number(telegramId);
  if (!Number.isFinite(id)) throw new Error('telegramId raqam bo‘lishi kerak');
  if (!ROLE_RANK[role]) throw new Error('role faqat superadmin yoki moderator');

  await Admin.updateOne({ telegramId: id }, { $set: { role } }, { upsert: true });
}

async function deleteAdmin(telegramId) {
  const id = Number(telegramId);
  if (!Number.isFinite(id)) throw new Error('telegramId raqam bo‘lishi kerak');

  const res = await Admin.deleteOne({ telegramId: id });
  return res.deletedCount === 1;
}

module.exports = {
  ensureSuperadminsFromEnv,
  getRole,
  hasAtLeastRole,
  listAdmins,
  upsertAdmin,
  deleteAdmin
};
