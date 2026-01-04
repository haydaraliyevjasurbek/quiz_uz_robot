const User = require('../models/User');
const testService = require('../services/testService');
const quizEngine = require('../services/quizEngine');
const channelService = require('../services/channelService');

function buildUserTestsText(tests) {
  const lines = ['🧪 Testlar ro\'yxati:', ''];
  for (const t of tests) {
    const qCount = Number(t.qCount || 0);
    const title = String(t.title || 'Test');
    lines.push(`- ${title} (${qCount} ta savol)`);
  }
  lines.push('', 'Boshlash uchun testni tanlang:');
  return lines.join('\n');
}

function truncateButtonText(s, maxLen) {
  const t = String(s || '').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

function buildUserTestsKb(tests) {
  const rows = [];

  // Quick-start: today's most attempted test
  rows.push([{ text: '🔥 Bugungi TOP test', callback_data: 'u_top_today' }]);

  for (let i = 0; i < tests.length; i += 2) {
    const a = tests[i];
    const b = tests[i + 1];
    const row = [];
    row.push({ text: truncateButtonText(a.title, 32), callback_data: `u_test:${a._id}` });
    if (b) row.push({ text: truncateButtonText(b.title, 32), callback_data: `u_test:${b._id}` });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

async function sendUserTestsList(ctx) {
  await quizEngine.ensureDefaultTestExists();

  const tests = await testService.listTests(20);
  if (!tests.length) {
    await ctx.reply('Hozircha testlar mavjud emas. Keyinroq urinib ko\'ring.');
    return;
  }

  await ctx.reply(buildUserTestsText(tests), { reply_markup: buildUserTestsKb(tests) });
}

async function showUserTests(ctx, { skipSubCheck } = {}) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId }, { _id: 1, step: 1, telegramId: 1 }).lean();
  if (!user) {
    await ctx.reply('Iltimos, avval /start bosing.');
    return;
  }

  if (!skipSubCheck) {
    const sub = await channelService.checkAndUpdateUserChannels(ctx);
    if (!sub.ok) {
      await channelService.sendSubscriptionPrompt(ctx, sub.channels);
      return;
    }
  }

  if (user.step === 'in_quiz') {
    await ctx.reply('Sizda allaqachon aktiv test bor. Javob berishda davom eting.');
    return;
  }

  await sendUserTestsList(ctx);
}

async function startSelectedTest(ctx, testId) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  if (!user) {
    await ctx.reply('Iltimos, avval /start bosing.');
    return;
  }

  // Re-check mandatory channels right before starting.
  const sub = await channelService.checkAndUpdateUserChannels(ctx);
  if (!sub.ok) {
    await channelService.sendSubscriptionPrompt(ctx, sub.channels);
    return;
  }

  if (user.step === 'in_quiz') {
    await ctx.reply('Sizda allaqachon aktiv test bor. Javob berishda davom eting.');
    return;
  }

  await quizEngine.startTestById(ctx, user, testId);
}

module.exports = {
  showUserTests,
  sendUserTestsList,
  startSelectedTest
};
