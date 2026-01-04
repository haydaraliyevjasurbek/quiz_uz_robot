const testService = require('../services/testService');
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

async function onTests(ctx) {
  if (!(await requireModerator(ctx))) return;

  const tests = await testService.listTests(30);
  if (!tests.length) {
    await ctx.reply('🧪 Test yo‘q. Admin panel → Testlar orqali test qo‘shing.');
    return;
  }

  const lines = ['🧪 Testlar:'];
  for (const t of tests) {
    const qCount = Number(t.qCount || 0);
    lines.push(`- ${t.title} | id: ${t._id} | savollar: ${qCount}`);
  }

  await ctx.reply(lines.join('\n'));
}

async function onTestAdd(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const title = text.replace('/test_add', '').trim();

  try {
    const t = await testService.addTest(title);
    await ctx.reply(`✅ Test qo‘shildi: ${t.title}\nid: ${t._id}`);
  } catch (e) {
    await ctx.reply(`Xatolik: ${e.message}`);
  }
}

async function onTestDel(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length !== 2) {
    await ctx.reply('Format: /test_del <testId>');
    return;
  }

  const ok = await testService.deleteTest(parts[1]);
  await ctx.reply(ok ? '✅ O‘chirildi.' : 'Test topilmadi.');
}

async function onQuestionAdd(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const payload = text.replace('/question_add', '').trim();

  const parsed = testService.parseQuestionAddPayload(payload);
  if (parsed.error) {
    await ctx.reply(parsed.error);
    return;
  }

  const ok = await testService.addQuestion(parsed);
  await ctx.reply(ok ? '✅ Savol qo‘shildi.' : 'Test topilmadi.');
}

module.exports = {
  onTests,
  onTestAdd,
  onTestDel,
  onQuestionAdd
};
