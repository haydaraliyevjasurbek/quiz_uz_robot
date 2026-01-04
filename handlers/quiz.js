const User = require('../models/User');
const quizEngine = require('../services/quizEngine');
const channelService = require('../services/channelService');

/**
 * Legacy handler: "Testni boshlash" matnini ushlaydi va testni ishga tushiradi.
 * Asosiy UX hozir: 🧪 Testlar ro‘yxatidan tanlab boshlash.
 */
async function onStartQuiz(ctx) {
  const telegramId = ctx.from.id;
  const user = await User.findOne({ telegramId });
  if (!user) {
    await ctx.reply('Iltimos, avval /start bosing.');
    return;
  }

  // Test boshlashdan oldin majburiy kanallar tekshiruvi
  const sub = await channelService.checkAndUpdateUserChannels(ctx);
  if (!sub.ok) {
    await channelService.sendSubscriptionPrompt(ctx, sub.channels);
    return;
  }

  if (user.step === 'in_quiz') {
    await ctx.reply('Sizda allaqachon aktiv test bor. Javob berishda davom eting.');
    return;
  }

  await quizEngine.startTest(ctx, user);
}

module.exports = {
  onStartQuiz
};
