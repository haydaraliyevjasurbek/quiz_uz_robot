const Result = require('../models/Result');
const { toCsv } = require('../utils/csv');
const adminService = require('../services/adminService');

async function requireModerator(ctx) {
  const telegramId = ctx.from && ctx.from.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply(
      `Bu buyruq faqat adminlar (moderator+) uchun.\n` +
        `Sizning Telegram ID: ${telegramId || '(unknown)'}\n` +
        `Admin qilish: superadmin /admin_add ${telegramId} moderator yoki .env ADMIN_IDS ga qo‘shib restart qiling.`
    );
    return false;
  }
  return true;
}

/**
 * /export_results <testId>
 * Result'larni CSV qilib document sifatida yuboradi.
 */
async function onExportResults(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length !== 2) {
    await ctx.reply('Format: /export_results <testId>');
    return;
  }

  const testId = parts[1];

  const results = await Result.find(
    { testId },
    { score: 1, totalQuestions: 1, completedAt: 1, userId: 1 }
  )
    .sort({ completedAt: -1 })
    .limit(50_000)
    .populate('userId', 'telegramId username')
    .populate('testId', 'title')
    .lean();

  if (!results.length) {
    await ctx.reply('Bu test bo‘yicha natija topilmadi.');
    return;
  }

  const header = ['testId', 'testTitle', 'telegramId', 'username', 'score', 'totalQuestions', 'completedAt'];
  const rows = [header];

  for (const r of results) {
    rows.push([
      String(r.testId && r.testId._id ? r.testId._id : testId),
      r.testId && r.testId.title ? r.testId.title : '',
      r.userId && r.userId.telegramId ? String(r.userId.telegramId) : '',
      r.userId && r.userId.username ? r.userId.username : '',
      String(r.score),
      String(r.totalQuestions),
      r.completedAt ? new Date(r.completedAt).toISOString() : ''
    ]);
  }

  const csv = toCsv(rows);
  const buf = Buffer.from(csv, 'utf8');

  const filename = `results_${testId}.csv`;
  await ctx.replyWithDocument({ source: buf, filename }, { caption: `CSV export: ${results.length} rows` });
}

module.exports = {
  onExportResults
};
