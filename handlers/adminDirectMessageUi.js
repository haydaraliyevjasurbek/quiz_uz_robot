const { Markup } = require('telegraf');

const adminService = require('../services/adminService');
const User = require('../models/User');

// In-memory state: adminId -> { stage: 'await_user_id' | 'await_message', targetUserId?: number }
const dmState = new Map();

async function requireAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    try {
      await ctx.reply('Bu bo‘lim faqat adminlar uchun.');
    } catch (_) {
      // ignore
    }
    return false;
  }
  return true;
}

function dmKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Bekor qilish', 'admin_dm:cancel')],
    [Markup.button.callback('⬅️ Admin panel', 'admin_panel:home')]
  ]);
}

function parseTelegramId(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function startAdminDirectMessage(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const adminId = ctx.from?.id;
  if (!adminId) return;

  dmState.set(adminId, { stage: 'await_user_id' });
  await ctx.reply(
    '✉️ Userga xabar yuborish\n\nUser Telegram ID ni yuboring (faqat raqam):',
    dmKb()
  );
}

async function cancelAdminDirectMessage(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const adminId = ctx.from?.id;
  if (adminId) dmState.delete(adminId);

  try {
    await ctx.answerCbQuery('Bekor qilindi');
  } catch (_) {
    // ignore
  }

  await ctx.reply('Bekor qilindi.', dmKb());
}

async function onAnyMessage(ctx, next) {
  const adminId = ctx.from?.id;
  if (!adminId) return next();

  const state = dmState.get(adminId);
  if (!state) return next();

  if (!(await adminService.hasAtLeastRole(adminId, 'moderator'))) {
    dmState.delete(adminId);
    return next();
  }

  if (!ctx.message) return next();

  // Stage 1: waiting for user id
  if (state.stage === 'await_user_id') {
    const text = typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const targetUserId = parseTelegramId(text);
    if (!targetUserId) {
      await ctx.reply('❌ ID noto‘g‘ri. User Telegram ID ni raqam ko‘rinishida yuboring:', dmKb());
      return;
    }

    // Optional: show user info if exists
    const u = await User.findOne(
      { telegramId: targetUserId },
      { telegramId: 1, username: 1, firstName: 1, lastName: 1 }
    ).lean();

    dmState.set(adminId, { stage: 'await_message', targetUserId });

    const extra = [];
    if (u) {
      const username = u.username ? `@${u.username}` : '';
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      extra.push(`Topildi: ${[name, username].filter(Boolean).join(' ') || '(ma’lumot yo‘q)'}`);
    } else {
      extra.push('Eslatma: bu ID DBda topilmadi, lekin Telegramga yuborib ko‘ramiz.');
    }

    await ctx.reply(
      `✅ Qabul qilindi. ID: ${targetUserId}\n${extra.join('\n')}\n\nEndi userga yuboriladigan xabarni yuboring (matn/rasm/fayl bo‘lishi mumkin):`,
      dmKb()
    );
    return;
  }

  // Stage 2: forward the next message to the selected user
  if (state.stage === 'await_message') {
    const targetUserId = state.targetUserId;
    if (!targetUserId) {
      dmState.delete(adminId);
      return next();
    }

    try {
      await ctx.telegram.sendMessage(targetUserId, '📬 Admin xabari:');
      await ctx.telegram.forwardMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
      await ctx.reply('✅ Xabar userga yuborildi.', dmKb());
    } catch (e) {
      await ctx.reply('❌ Yuborib bo‘lmadi (user botni block qilgan bo‘lishi mumkin).', dmKb());
    } finally {
      dmState.delete(adminId);
    }

    return;
  }

  return next();
}

function registerAdminDirectMessageUi(bot) {
  bot.action('admin_dm:cancel', cancelAdminDirectMessage);

  // Capture any message while admin is in DM mode.
  bot.on('message', onAnyMessage);
}

module.exports = {
  registerAdminDirectMessageUi,
  startAdminDirectMessage
};
