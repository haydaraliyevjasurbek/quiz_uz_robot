const { Markup } = require('telegraf');
const PostReaction = require('../models/PostReaction');
const PostVote = require('../models/PostVote');

function normalizeChatId(chatId) {
  return String(chatId);
}

function buildReactionsKb({ up, down }) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`👍 ${Number(up) || 0}`, 'react:up'),
      Markup.button.callback(`👎 ${Number(down) || 0}`, 'react:down')
    ]
  ]);
}

async function ensureReactionRow({ chatId, messageId }) {
  const c = normalizeChatId(chatId);
  const mid = Number(messageId);
  if (!Number.isFinite(mid)) return null;

  try {
    await PostReaction.updateOne(
      { chatId: c, messageId: mid },
      { $setOnInsert: { chatId: c, messageId: mid, up: 0, down: 0 } },
      { upsert: true }
    );
  } catch (_) {
    // ignore duplicate races
  }

  return PostReaction.findOne({ chatId: c, messageId: mid }, { up: 1, down: 1 }).lean();
}

async function getCounts({ chatId, messageId }) {
  const c = normalizeChatId(chatId);
  const mid = Number(messageId);
  const row = await PostReaction.findOne({ chatId: c, messageId: mid }, { up: 1, down: 1 }).lean();
  if (!row) return { up: 0, down: 0 };
  return { up: Number(row.up) || 0, down: Number(row.down) || 0 };
}

async function applyVote({ chatId, messageId, telegramId, vote }) {
  const c = normalizeChatId(chatId);
  const mid = Number(messageId);
  const tid = Number(telegramId);
  if (!Number.isFinite(mid) || !Number.isFinite(tid)) {
    return { ok: false, reason: 'bad_id', counts: { up: 0, down: 0 } };
  }
  if (vote !== 'up' && vote !== 'down') {
    return { ok: false, reason: 'bad_vote', counts: { up: 0, down: 0 } };
  }

  // Make sure counts row exists
  await ensureReactionRow({ chatId: c, messageId: mid });

  const existing = await PostVote.findOne({ chatId: c, messageId: mid, telegramId: tid }, { vote: 1 }).lean();

  if (!existing) {
    try {
      await PostVote.create({ chatId: c, messageId: mid, telegramId: tid, vote });
    } catch (_) {
      // race: someone created it, refetch
      return applyVote({ chatId: c, messageId: mid, telegramId: tid, vote });
    }

    await PostReaction.updateOne(
      { chatId: c, messageId: mid },
      { $inc: vote === 'up' ? { up: 1 } : { down: 1 } }
    );

    const counts = await getCounts({ chatId: c, messageId: mid });
    return { ok: true, changed: true, counts };
  }

  if (existing.vote === vote) {
    const counts = await getCounts({ chatId: c, messageId: mid });
    return { ok: true, changed: false, counts };
  }

  // Switch vote
  await PostVote.updateOne({ chatId: c, messageId: mid, telegramId: tid }, { $set: { vote } });
  await PostReaction.updateOne(
    { chatId: c, messageId: mid },
    { $inc: vote === 'up' ? { up: 1, down: -1 } : { up: -1, down: 1 } }
  );

  const counts = await getCounts({ chatId: c, messageId: mid });
  return { ok: true, changed: true, counts };
}

module.exports = {
  buildReactionsKb,
  getCounts,
  ensureReactionRow,
  applyVote
};
