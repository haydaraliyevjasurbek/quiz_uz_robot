const User = require('../models/User');
const Channel = require('../models/Channel');
const broadcastService = require('./broadcastService');
const reactionService = require('./reactionService');

function parseSegment(segmentRaw) {
  const segment = (segmentRaw || '').trim();
  if (!segment) return { ok: false, error: 'segment bo‘sh' };

  if (segment === 'all') return { ok: true, type: 'all' };
  if (segment === 'subscribed') return { ok: true, type: 'subscribed' };
  if (segment === 'not_subscribed') return { ok: true, type: 'not_subscribed' };

  if (segment.startsWith('source:')) {
    const channelId = segment.slice('source:'.length);
    if (!channelId) return { ok: false, error: 'source:<channelId> kerak' };
    return { ok: true, type: 'source', channelId };
  }

  return { ok: false, error: 'segment: all|subscribed|not_subscribed|source:<channelId>' };
}

async function buildUserQuery(seg) {
  const base = { telegramId: { $ne: null }, isBlocked: { $ne: true } };

  if (seg.type === 'all') return base;

  if (seg.type === 'source') {
    return { ...base, sourceChannelId: seg.channelId };
  }

  const activeChannels = await Channel.find({ isActive: true }, { channelId: 1 }).lean();
  const activeIds = activeChannels.map((c) => String(c.channelId));

  if (!activeIds.length) {
    return seg.type === 'subscribed'
      ? base
      : { ...base, _id: { $exists: false } };
  }

  if (seg.type === 'subscribed') {
    return { ...base, joinedChannels: { $all: activeIds } };
  }

  return {
    ...base,
    $or: [{ joinedChannels: { $exists: false } }, { joinedChannels: { $not: { $all: activeIds } } }],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTelegramErrorInfo(err) {
  const code = err?.code || err?.response?.error_code;
  const description = err?.description || err?.response?.description;
  const retryAfter = err?.parameters?.retry_after || err?.response?.parameters?.retry_after;
  return {
    code: Number(code) || null,
    description: description ? String(description) : '',
    retryAfter: Number(retryAfter) || null
  };
}

async function sendWithRetry(telegram, telegramId, sender, opts) {
  const maxRetries = opts.maxRetries;
  const baseDelayMs = opts.delayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await sender(telegram, telegramId);
      return { ok: true };
    } catch (err) {
      const info = getTelegramErrorInfo(err);

      if (info.code === 403 || info.code === 400) {
        return { ok: false, permanent: true, info };
      }

      if (info.code === 429) {
        const waitMs = Math.max(1000, (info.retryAfter || 1) * 1000);
        await sleep(waitMs);
        continue;
      }

      if (attempt < maxRetries) {
        await sleep(Math.max(250, baseDelayMs) * (attempt + 1));
        continue;
      }

      return { ok: false, permanent: false, info };
    }
  }

  return { ok: false, permanent: false, info: { code: null, description: 'unknown', retryAfter: null } };
}

async function flushBatchOrderedConcurrent({
  telegram,
  job,
  batch,
  sender,
  opts,
  total,
  state,
  progressEvery,
  cancelCheckEvery
}) {
  const size = batch.length;
  if (!size) return { canceled: false };

  const concurrency = Math.max(1, Math.min(opts.concurrency, size));
  const promises = new Array(size);
  let nextToStart = 0;

  const startOne = (idx) => {
    const u = batch[idx];
    promises[idx] = (async () => {
      const res = await sendWithRetry(telegram, u.telegramId, sender, {
        maxRetries: opts.maxRetries,
        delayMs: opts.delayMs
      });

      if (!res.ok && res.permanent) {
        await User.updateOne({ _id: u._id }, { $set: { isBlocked: true, blockedAt: new Date() } });
      }

      if (opts.delayMs) await sleep(opts.delayMs);
      return res;
    })();
  };

  for (; nextToStart < Math.min(concurrency, size); nextToStart += 1) {
    startOne(nextToStart);
  }

  for (let i = 0; i < size; i += 1) {
    if (!promises[i]) startOne(i);
    const res = await promises[i];

    const u = batch[i];
    state.scanned += 1;
    if (res.ok) state.sent += 1;
    else state.failed += 1;

    await broadcastService.incProgress(
      job._id,
      { scanned: 1, sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1 },
      { lastUserObjectId: u._id }
    );

    const done = state.sent + state.failed;
    if (done % progressEvery === 0) {
      // worker mode’da reply yo‘q, faqat DB progress
      // (bot tarafida /broadcast_status bilan ko‘riladi)
    }

    if (done % cancelCheckEvery === 0) {
      const freshJob = await broadcastService.getJob(job._id);
      if (freshJob && freshJob.status === 'canceled') {
        return { canceled: true };
      }
    }

    if (nextToStart < size) {
      startOne(nextToStart);
      nextToStart += 1;
    }
  }

  batch.length = 0;
  return { canceled: false };
}

function makeSender(job) {
  if (job.mode === 'copy') {
    return async (telegram, telegramId) => {
      const extra = {};
      if (job.captionOverride) extra.caption = job.captionOverride;
      extra.reply_markup = reactionService.buildReactionsKb({ up: 0, down: 0 }).reply_markup;
      await telegram.copyMessage(
        telegramId,
        job.sourceChatId,
        job.sourceMessageId,
        Object.keys(extra).length ? extra : undefined
      );
    };
  }

  return async (telegram, telegramId) => {
    await telegram.sendMessage(telegramId, job.messageText, {
      reply_markup: reactionService.buildReactionsKb({ up: 0, down: 0 }).reply_markup
    });
  };
}

async function runBroadcastJob({ telegram, jobId }) {
  const job = await broadcastService.getJob(jobId);
  if (!job) throw new Error('Job topilmadi');
  if (job.status !== 'running') throw new Error(`Job status running emas: ${job.status}`);

  const segParsed = parseSegment(job.segment);
  if (!segParsed.ok) throw new Error(`Segment xato: ${segParsed.error}`);

  const BATCH_SIZE = Math.max(1, Number(process.env.BROADCAST_BATCH_SIZE || 25));
  const DELAY_MS = Math.max(0, Number(process.env.BROADCAST_DELAY_MS || 35));
  const MAX_RETRIES = Math.max(0, Number(process.env.BROADCAST_MAX_RETRIES || 2));
  const CONCURRENCY = Math.max(1, Number(process.env.BROADCAST_CONCURRENCY || 3));
  const CANCEL_CHECK_EVERY = Math.max(25, Number(process.env.BROADCAST_CANCEL_CHECK_EVERY || 500));

  const sender = makeSender(job);

  const query = await buildUserQuery(segParsed);
  if (job.lastUserObjectId) {
    query._id = { $gt: job.lastUserObjectId };
  }

  const total = job.total || (await User.countDocuments(await buildUserQuery(segParsed)));
  const state = { sent: 0, failed: 0, scanned: 0 };

  const cursor = User.find(query, { telegramId: 1 })
    .sort({ _id: 1 })
    .lean()
    .cursor();

  const batch = [];
  const flushBatch = async () =>
    flushBatchOrderedConcurrent({
      telegram,
      job,
      batch,
      sender,
      opts: { maxRetries: MAX_RETRIES, delayMs: DELAY_MS, concurrency: Math.min(CONCURRENCY, BATCH_SIZE) },
      total,
      state,
      progressEvery: 999999999,
      cancelCheckEvery: CANCEL_CHECK_EVERY
    });

  for await (const u of cursor) {
    batch.push(u);
    if (batch.length >= BATCH_SIZE) {
      const r = await flushBatch();
      if (r.canceled) {
        return { canceled: true, state };
      }
    }
  }

  const r = await flushBatch();
  if (r.canceled) return { canceled: true, state };

  await broadcastService.markDone(job._id);
  return { canceled: false, state };
}

module.exports = {
  parseSegment,
  buildUserQuery,
  runBroadcastJob
};
