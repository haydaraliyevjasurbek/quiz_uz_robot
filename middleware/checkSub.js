const channelService = require('../services/channelService');
const User = require('../models/User');

/**
 * Middleware: har bir xabar oldidan majburiy kanal a’zoligini tekshiradi.
 * - Adminlar ham tekshiriladi.
 * - Callback `ans:` (quiz javoblari) bloklanmaydi.
 * - Callback `stop:` (testni to‘xtatish) bloklanmaydi.
 * - A’zo bo‘lmasa: kanallar ro‘yxati + "Tekshirish" tugmasi.
 */
function checkSub() {
  return async (ctx, next) => {
    // Faqat user update'larda ishlasin
    if (!ctx.from) return next();

    // /start ni handlerning o'zi tekshiradi (payload analytics uchun)
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    if (text.startsWith('/start')) return next();

    // Live status monitoring (env user) should work even if not subscribed.
    if (text.startsWith('/live_status') || text === '📡 Live status') {
      return next();
    }

    // Contact admin should work even if user isn't subscribed.
    if (text === '✉️ Admin ga yozish' || text === 'Admin ga yozish' || text.startsWith('/contact_admin')) {
      return next();
    }

    // Quiz answer callback'larini bloklamaymiz
    const cbData = ctx.callbackQuery && ctx.callbackQuery.data;
    if (cbData && cbData.startsWith('ans:')) return next();
    if (cbData && cbData.startsWith('stop:')) return next();
    if (cbData && cbData.startsWith('react:')) return next();
    if (cbData === 'check_sub' || cbData === 'noop') return next();

    // If user is currently contacting admin, don't block.
    try {
      const u = await User.findOne({ telegramId: ctx.from.id }, { step: 1 }).lean();
      if (u && u.step === 'contact_admin') return next();
    } catch (_) {
      // ignore
    }

    // /start va test boshlashda yoki oddiy message'da tekshirish
    const res = await channelService.checkAndUpdateUserChannels(ctx);
    if (res.ok) return next();

    await channelService.sendSubscriptionPrompt(ctx, res.channels);
    return;
  };
}

module.exports = checkSub;
