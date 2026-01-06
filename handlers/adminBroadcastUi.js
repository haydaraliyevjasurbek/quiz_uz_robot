const requireRole = require('../middleware/requireRole');
const broadcastService = require('../services/broadcastService');
const { parseSegment, buildUserQuery, runBroadcastJob } = require('../services/broadcastRunner');
const auditService = require('../services/auditService');
const User = require('../models/User');
const reactionService = require('../services/reactionService');

const DEFAULT_RUN_MODE = (process.env.BROADCAST_RUN_MODE || 'worker').toLowerCase();

// In-memory wizard state (ok for MVP)
// telegramId ->
//   { step: 'pick_segment' | 'await_message', segment: 'all'|'subscribed'|'not_subscribed' }
//   { step: 'await_chat', targetChat: '' }
//   { step: 'await_chat_message', targetChat: '' }
const broadcastState = new Map();

function kbPickSegment(Markup) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 Barchaga', 'admin_broadcast:seg:all')],
    [Markup.button.callback('✅ A’zo bo‘lganlarga', 'admin_broadcast:seg:subscribed')],
    [Markup.button.callback('❌ A’zo bo‘lmaganlarga', 'admin_broadcast:seg:not_subscribed')],
    [Markup.button.callback('📣 Kanal/Guruhga', 'admin_broadcast:to_chat')],
    [Markup.button.callback('⬅️ Orqaga', 'admin_panel:home'), Markup.button.callback('❌ Bekor', 'admin_broadcast:cancel')]
  ]);
}

function parseTargetChat(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s; // @username or public channel/group username
}

async function startAdminBroadcast(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  broadcastState.set(telegramId, { step: 'pick_segment', segment: '' });
  const { Markup } = require('telegraf');

  await ctx.reply('📢 Broadcast: qaysi segmentga yuboramiz?', kbPickSegment(Markup));
}

async function cancelAdminBroadcast(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  broadcastState.delete(telegramId);
  try {
    await ctx.editMessageText('❌ Broadcast bekor qilindi.');
  } catch (_) {
    await ctx.reply('❌ Broadcast bekor qilindi.');
  }
}

async function onPickSegment(ctx, segment) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const segParsed = parseSegment(segment);
  if (!segParsed.ok) {
    await ctx.answerCbQuery('Segment xato');
    return;
  }

  const query = await buildUserQuery(segParsed);
  const total = await User.countDocuments(query);
  if (!total) {
    await ctx.answerCbQuery();
    await ctx.reply('Bu segmentda user yo‘q.');
    broadcastState.delete(telegramId);
    return;
  }

  broadcastState.set(telegramId, { step: 'await_message', segment });
  await ctx.answerCbQuery('Tanlandi');

  const { Markup } = require('telegraf');
  await ctx.reply(
    `✅ Segment: ${segment}\n` +
      `👥 Userlar: ${total}\n\n` +
      `Endi yuboriladigan xabarni jo‘nating (matn/rasm/video/forward).\n` +
      `Bekor qilish uchun: ❌ Bekor`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_broadcast:cancel')]])
  );
}

async function startTargetChatFlow(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  broadcastState.set(telegramId, { step: 'await_chat', targetChat: '' });
  await ctx.reply(
    '📣 Kanal/Guruhga yuborish:\n' +
      '- Kanal/guruh ID yuboring (masalan: -1001234567890)\n' +
      '- Yoki public bo‘lsa @username (masalan: @my_channel)\n\n' +
      'Eslatma: bot o‘sha kanal/guruhda admin bo‘lishi va yozish huquqiga ega bo‘lishi kerak.'
  );
}

async function handleBroadcastMessage(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const st = broadcastState.get(telegramId);
  if (!st) return false;

  // Step 1: admin sends target chat id/username
  if (st.step === 'await_chat') {
    const target = parseTargetChat(ctx.message?.text);
    if (!target) {
      await ctx.reply('Chat ID yoki @username yuboring. Masalan: -1001234567890 yoki @my_channel');
      return true;
    }

    broadcastState.set(telegramId, { step: 'await_chat_message', targetChat: target });
    const { Markup } = require('telegraf');
    await ctx.reply(
      `✅ Tanlandi: ${String(target)}\n\nEndi yuboriladigan xabarni jo‘nating (matn/rasm/video/forward).`,
      Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_broadcast:cancel')]])
    );
    return true;
  }

  // Step 2: admin sends the message to be posted to that chat
  if (st.step === 'await_chat_message') {
    const targetChat = st.targetChat;
    broadcastState.delete(telegramId);

    try {
      await ctx.telegram.copyMessage(targetChat, ctx.chat?.id, ctx.message?.message_id, {
        reply_markup: reactionService.buildReactionsKb({ up: 0, down: 0 }).reply_markup
      });

      await auditService.logAdminAction(ctx, 'broadcast_to_chat', String(targetChat), {
        targetChat: String(targetChat)
      });

      await ctx.reply('✅ Xabar kanal/guruhga yuborildi.');
    } catch (err) {
      const code = err?.code || err?.response?.error_code;
      const desc = err?.description || err?.response?.description || '';

      // Telegram commonly returns 403 / 400 for rights issues
      if (Number(code) === 403 || Number(code) === 400) {
        await ctx.reply(`❌ Shu kanalda/guruhda menga huquq yo‘q. (Botni admin qiling)\n${desc ? `\n${desc}` : ''}`);
      } else {
        await ctx.reply(`❌ Xatolik yuz berdi: ${desc || String(err)}`);
      }
    }

    return true;
  }

  if (st.step !== 'await_message' || !st.segment) return false;

  // Stop wizard right away to prevent double-send on retries
  broadcastState.delete(telegramId);

  const segParsed = parseSegment(st.segment);
  if (!segParsed.ok) {
    await ctx.reply(`Segment xato: ${segParsed.error}`);
    return true;
  }

  const query = await buildUserQuery(segParsed);
  const total = await User.countDocuments(query);
  if (!total) {
    await ctx.reply('Bu segmentda user yo‘q.');
    return true;
  }

  const createdByTelegramId = telegramId;
  const job = await broadcastService.createCopyJob({
    createdByTelegramId,
    segment: st.segment,
    sourceChatId: ctx.chat?.id,
    sourceMessageId: ctx.message?.message_id,
    captionOverride: '',
    total
  });

  await auditService.logAdminAction(ctx, 'broadcast_create_ui', String(job._id), {
    segment: st.segment,
    mode: job.mode
  });

  if (DEFAULT_RUN_MODE === 'inline') {
    await broadcastService.touchProgress(job._id, { status: 'running', startedAt: new Date(), workerId: '', lockedAt: null });
    await ctx.reply(`📢 Broadcast (inline) boshlandi. Job: ${job._id}`);
    try {
      await runBroadcastJob({ telegram: ctx.telegram, jobId: job._id });
      const doneJob = await broadcastService.getJob(job._id);
      await ctx.reply(
        `✅ Tugadi. Job=${job._id} Total=${doneJob.total}, sent=${doneJob.sent}, failed=${doneJob.failed}, scanned=${doneJob.scanned}`
      );
    } catch (err) {
      await broadcastService.markFailed(job._id, err?.message || String(err));
      throw err;
    }

    return true;
  }

  await ctx.reply(
    `📢 Broadcast queue'ga qo‘yildi. Job: ${job._id}\n` +
      `Mode: ${job.mode}\n` +
      `Worker ishlashi uchun: npm run worker:broadcast\n` +
      `Status: /broadcast_status ${job._id}`
  );

  return true;
}

function registerAdminBroadcastUi(bot) {
  // Only superadmin can use broadcast
  bot.action('admin_panel:broadcast', requireRole('superadmin'), async (ctx) => {
    await ctx.answerCbQuery();
    await startAdminBroadcast(ctx);
  });

  bot.action('admin_broadcast:cancel', requireRole('superadmin'), async (ctx) => {
    await ctx.answerCbQuery('Bekor qilindi');
    await cancelAdminBroadcast(ctx);
  });

  bot.action(/^admin_broadcast:seg:(all|subscribed|not_subscribed)$/, requireRole('superadmin'), async (ctx) => {
    const seg = ctx.match && ctx.match[1];
    await onPickSegment(ctx, seg);
  });

  bot.action('admin_broadcast:to_chat', requireRole('superadmin'), async (ctx) => {
    await ctx.answerCbQuery();
    await startTargetChatFlow(ctx);
  });

  // Catch the next message from superadmin in the wizard
  bot.on('message', requireRole('superadmin'), async (ctx, next) => {
    const handled = await handleBroadcastMessage(ctx);
    if (handled) return;
    return next();
  });
}

module.exports = {
  registerAdminBroadcastUi
};
