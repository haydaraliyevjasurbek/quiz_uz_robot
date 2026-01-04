const Result = require('../models/Result');
const User = require('../models/User');
const adminService = require('../services/adminService');

async function requireAdminUser(ctx) {
  const telegramId = ctx.from && ctx.from.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply('Bu buyruq faqat adminlar uchun.');
    return false;
  }
  return true;
}

function clampLimit(raw, def, max) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function formatDateTimeShort(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return '';
  try {
    // 04.01.2026 14:15 ko‘rinishiga yaqin
    const s = dt.toLocaleString('uz-UZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    return s.replace(',', '');
  } catch (_) {
    return dt.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function medalByIndex(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return '•';
}

/**
 * /results_all [limit]
 * So'nggi natijalarni user bo'yicha jamlab ko'rsatadi.
 */
async function onResultsAll(ctx) {
  if (!(await requireAdminUser(ctx))) return;

  const parts = ctx.message?.text ? ctx.message.text.trim().split(/\s+/) : [];
  const limit = clampLimit(parts[1], 50, 200);

  // Avval so'nggi N urinishni olamiz, keyin user bo'yicha jamlaymiz
  const rows = await Result.aggregate([
    { $sort: { completedAt: -1 } },
    { $limit: limit },
    { $group: { _id: '$userId', attempts: { $sum: 1 }, lastAt: { $max: '$completedAt' } } },
    { $sort: { attempts: -1, lastAt: -1 } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { attempts: 1, lastAt: 1, telegramId: '$user.telegramId', username: '$user.username' } }
  ]);

  if (!rows.length) {
    await ctx.reply('Natijalar yo‘q.');
    return;
  }

  const lines = [`📌 Natijalar (so‘nggi ${limit} urinish bo‘yicha):`];
  rows.forEach((row) => {
    const when = formatDateTimeShort(row.lastAt);
    const tgId = row.telegramId ? String(row.telegramId) : '';
    const uname = row.username ? `@${row.username}` : '';
    const who = uname || (tgId ? `(${tgId})` : '(unknown)');

    const meta = [];
    if (uname && tgId) meta.push(`(${tgId})`);
    if (when) meta.push(`Oxirgi: ${when}`);
    lines.push(`- ${who}${meta.length ? ` ${meta.join(' | ')}` : ''} — ${row.attempts} marta`);
  });

  await ctx.reply(lines.join('\n'));
}

/**
 * /attempts_top [limit]
 * Qaysi user nech marta test yechgan (top ro'yxat).
 */
async function onAttemptsTop(ctx) {
  if (!(await requireAdminUser(ctx))) return;

  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const limit = clampLimit(parts[1], 20, 50);

  const rows = await Result.aggregate([
    { $group: { _id: '$userId', attempts: { $sum: 1 }, lastAt: { $max: '$completedAt' } } },
    { $sort: { attempts: -1, lastAt: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { attempts: 1, lastAt: 1, telegramId: '$user.telegramId', username: '$user.username' } }
  ]);

  if (!rows.length) {
    await ctx.reply('Natijalar yo‘q.');
    return;
  }

  const lines = ['📊 Test yechish (TOP):'];
  rows.forEach((row, i) => {
    const when = formatDateTimeShort(row.lastAt);
    const tgId = row.telegramId ? String(row.telegramId) : '';
    const uname = row.username ? `@${row.username}` : '';

    const title = uname || (tgId ? `ID: ${tgId}` : '(unknown)');
    lines.push(`${medalByIndex(i)} ${i + 1}) ${title} — ${row.attempts} marta`);

    const metaParts = [];
    if (when) metaParts.push(`Oxirgi: ${when}`);
    if (tgId && uname) metaParts.push(`ID: ${tgId}`);
    if (metaParts.length) lines.push(`   ${metaParts.join(' | ')}`);
  });

  await ctx.reply(lines.join('\n'));
}

/**
 * /attempts_user <telegramId>
 * Bitta user nech marta yechgani.
 */
async function onAttemptsUser(ctx) {
  if (!(await requireAdminUser(ctx))) return;

  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply('Format: /attempts_user <telegramId>');
    return;
  }

  const telegramId = Number(parts[1]);
  if (!Number.isFinite(telegramId)) {
    await ctx.reply('telegramId raqam bo‘lishi kerak.');
    return;
  }

  const user = await User.findOne({ telegramId }, { _id: 1, username: 1, telegramId: 1 }).lean();
  if (!user) {
    await ctx.reply('User topilmadi.');
    return;
  }

  const attempts = await Result.countDocuments({ userId: user._id });
  const uname = user.username ? `@${user.username}` : '';
  const who = [uname, `(${user.telegramId})`].filter(Boolean).join(' ');
  await ctx.reply(`👤 ${who} — ${attempts} marta test yechgan.`.trim());
}

module.exports = {
  onResultsAll,
  onAttemptsTop,
  onAttemptsUser
};
