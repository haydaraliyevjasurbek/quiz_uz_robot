const User = require('../models/User');
const Channel = require('../models/Channel');
const channelService = require('../services/channelService');
const adminService = require('../services/adminService');
const { buildMainMenuKeyboard } = require('../utils/keyboards');
const { sendUserTestsList } = require('./userTestsUi');

/**
 * /start handler:
 * - foydalanuvchini DB ga upsert qiladi
 * - asosiy menyu + testlar ro‘yxatini chiqaradi
 */
async function onStart(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';

  // Deep-link analytics: /start ch_<channelId>
  // Masalan: https://t.me/<bot>?start=ch_-1001234567890
  let sourceChannelId = null;
  if (ctx.startPayload && typeof ctx.startPayload === 'string') {
    const payload = ctx.startPayload.trim();
    if (payload.startsWith('ch_')) {
      sourceChannelId = payload.slice(3);
    }
  }

  // Agar sourceChannelId mavjud bo‘lsa va DB’da oldin yozilmagan bo‘lsa, set qilamiz
  const $set = {
    username,
    firstName,
    step: 'idle'
  };

  if (sourceChannelId) {
    const ch = await Channel.findOne({ channelId: String(sourceChannelId) }, { channelId: 1 }).lean();
    if (ch) {
      $set.sourceChannelId = String(sourceChannelId);
    }
  }

  await User.updateOne(
    { telegramId },
    {
      $set,
      $setOnInsert: {
        joinedAt: new Date()
      }
    },
    { upsert: true }
  );

  // Majburiy kanallar tekshiruvi
  const sub = await channelService.checkAndUpdateUserChannels(ctx);
  if (!sub.ok) {
    await channelService.sendSubscriptionPrompt(ctx, sub.channels);
    return;
  }

  const isAdmin = await adminService.hasAtLeastRole(telegramId, 'moderator');
  const kb = buildMainMenuKeyboard({ isAdmin });
  await ctx.reply(
    `Assalomu alaykum, ${firstName || 'do‘st'}!\nQUIZ UZ botiga xush kelibsiz.`,
    kb
  );

  // Main UX: always show tests list for users.
  await sendUserTestsList(ctx);
}

module.exports = {
  onStart
};
