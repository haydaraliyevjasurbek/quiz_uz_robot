const { Markup } = require('telegraf');

const User = require('../models/User');
const adminService = require('../services/adminService');

// In-memory per-admin reply state: adminId -> userTelegramId
const adminReplyState = new Map();

function cancelKb() {
  return Markup.inlineKeyboard([Markup.button.callback('❌ Bekor qilish', 'u_contact:cancel')]);
}

function adminCancelKb() {
  return Markup.inlineKeyboard([Markup.button.callback('❌ Bekor qilish', 'a_contact:cancel')]);
}

async function requireAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    try {
      await ctx.answerCbQuery('Faqat admin');
    } catch (_) {
      // ignore
    }
    return false;
  }
  return true;
}

function buildAdminHeader(ctx) {
  const from = ctx.from || {};
  const id = from.id;
  const username = from.username ? `@${from.username}` : '';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  const who = [name || 'User', username].filter(Boolean).join(' ');
  return `📩 Userdan xabar\n${who}\nID: ${id}`;
}

async function getAdminRecipients() {
  const admins = await adminService.listAdmins();
  const ids = admins
    .map((a) => Number(a.telegramId))
    .filter((n) => Number.isFinite(n));
  return Array.from(new Set(ids));
}

function buildReplyKb(userTelegramId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Javob berish', `a_contact:reply:${userTelegramId}`)]
  ]);
}

async function startContactAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // This flow is only for regular users.
  if (await adminService.hasAtLeastRole(telegramId, 'moderator')) {
    await ctx.reply('Bu funksiya faqat oddiy foydalanuvchilar uchun. Adminlar uchun kerak emas.');
    return;
  }

  const user = await User.findOne({ telegramId }, { _id: 1, step: 1 }).lean();
  if (!user) {
    await ctx.reply('Iltimos, avval /start bosing.');
    return;
  }

  if (user.step === 'in_quiz') {
    await ctx.reply('Hozir sizda aktiv test bor. Test tugagach adminga yozishingiz mumkin.');
    return;
  }

  const admins = await getAdminRecipients();
  if (!admins.length) {
    await ctx.reply('Hozircha admin topilmadi. Keyinroq urinib ko‘ring.');
    return;
  }

  await User.updateOne(
    { telegramId },
    {
      $set: {
        step: 'contact_admin',
        contactAdminStartedAt: new Date()
      }
    }
  );

  await ctx.reply('✉️ Adminga yuborish uchun xabaringizni yozing (matn/rasm/fayl ham bo‘ladi):', cancelKb());
}

async function cancelContact(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await User.updateOne(
    { telegramId, step: 'contact_admin' },
    {
      $set: { step: 'idle' },
      $unset: { contactAdminStartedAt: 1 }
    }
  );

  try {
    await ctx.answerCbQuery('Bekor qilindi');
  } catch (_) {
    // ignore
  }

  await ctx.reply('Bekor qilindi.');
}

async function startAdminReply(ctx, userTelegramId) {
  if (!(await requireAdmin(ctx))) return;

  const adminId = ctx.from?.id;
  const userId = Number(userTelegramId);
  if (!adminId || !Number.isFinite(userId)) {
    await ctx.answerCbQuery('Xatolik');
    return;
  }

  adminReplyState.set(adminId, userId);
  await ctx.answerCbQuery();
  await ctx.reply(`✍️ Userga javob yozing (ID: ${userId}). Yuborganingiz userga boradi.`, adminCancelKb());
}

async function cancelAdminReply(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const adminId = ctx.from?.id;
  if (adminId) adminReplyState.delete(adminId);
  try {
    await ctx.answerCbQuery('Bekor qilindi');
  } catch (_) {
    // ignore
  }
  await ctx.reply('Bekor qilindi.');
}

async function handleAdminReplyMessage(ctx) {
  const adminId = ctx.from?.id;
  if (!adminId) return false;
  const targetUserId = adminReplyState.get(adminId);
  if (!targetUserId) return false;

  // Only admins can use this mode.
  if (!(await adminService.hasAtLeastRole(adminId, 'moderator'))) {
    adminReplyState.delete(adminId);
    return false;
  }

  try {
    await ctx.telegram.sendMessage(targetUserId, '📬 Admin javobi:');
    await ctx.telegram.forwardMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
    await ctx.reply('✅ Javob userga yuborildi.');
  } catch (e) {
    await ctx.reply('❌ Yuborib bo‘lmadi (user botni block qilgan bo‘lishi mumkin).');
  } finally {
    adminReplyState.delete(adminId);
  }

  return true;
}

async function forwardToAdmins(ctx, admins) {
  const header = buildAdminHeader(ctx);

  const userId = ctx.from?.id;
  const kb = userId ? buildReplyKb(userId) : undefined;

  const results = await Promise.all(
    admins.map(async (adminId) => {
      try {
        await ctx.telegram.sendMessage(adminId, header, kb ? kb : undefined);
        await ctx.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
        return { ok: true };
      } catch (e) {
        return { ok: false, err: e };
      }
    })
  );

  return results.some((r) => r.ok);
}

async function onAnyMessage(ctx, next) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  // Ignore non-message updates here
  if (!ctx.message) return next();

  // Admin reply mode has priority.
  const adminHandled = await handleAdminReplyMessage(ctx);
  if (adminHandled) return;

  // Don't treat the menu button text itself as content.
  const text = typeof ctx.message.text === 'string' ? ctx.message.text.trim() : '';
  if (text === '✉️ Admin ga yozish' || text === 'Admin ga yozish' || text === '/contact_admin') {
    return next();
  }

  const user = await User.findOne({ telegramId }, { step: 1 }).lean();
  if (!user || user.step !== 'contact_admin') return next();

  const admins = await getAdminRecipients();
  if (!admins.length) {
    await ctx.reply('Hozircha admin topilmadi. Keyinroq urinib ko‘ring.');
    await User.updateOne(
      { telegramId, step: 'contact_admin' },
      { $set: { step: 'idle' }, $unset: { contactAdminStartedAt: 1 } }
    );
    return;
  }

  const ok = await forwardToAdmins(ctx, admins);

  await User.updateOne(
    { telegramId, step: 'contact_admin' },
    { $set: { step: 'idle' }, $unset: { contactAdminStartedAt: 1 } }
  );

  await ctx.reply(ok ? '✅ Xabaringiz adminga yuborildi.' : '❌ Xabar yuborilmadi. Keyinroq urinib ko‘ring.');
  return;
}

function registerContactAdmin(bot) {
  bot.hears(['✉️ Admin ga yozish', 'Admin ga yozish'], startContactAdmin);
  bot.command('contact_admin', startContactAdmin);

  bot.action('u_contact:cancel', cancelContact);

  // Admin: reply to user
  bot.action(/a_contact:reply:(\d+)/, async (ctx) => {
    const m = String(ctx.callbackQuery?.data || '').match(/^a_contact:reply:(\d+)$/);
    const userId = m ? m[1] : null;
    await startAdminReply(ctx, userId);
  });
  bot.action('a_contact:cancel', cancelAdminReply);

  // Capture any message while user is in contact_admin mode.
  bot.on('message', onAnyMessage);
}

module.exports = {
  registerContactAdmin
};
