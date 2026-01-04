const User = require('../models/User');
const requireRole = require('../middleware/requireRole');
const broadcastService = require('../services/broadcastService');
const { parseSegment, buildUserQuery, runBroadcastJob } = require('../services/broadcastRunner');
const auditService = require('../services/auditService');

const DEFAULT_RUN_MODE = (process.env.BROADCAST_RUN_MODE || 'worker').toLowerCase();

function formatJobLine(job) {
  return `- ${job._id} | ${job.status} | ${job.mode} | seg=${job.segment} | sent=${job.sent} failed=${job.failed}`;
}

function registerBroadcastHandler(bot) {
  // /broadcast <segment> <text...>
  bot.command('broadcast', requireRole('superadmin'), async (ctx) => {
    const fullText = (ctx.message?.text || '').trim();
    const match = fullText.match(/^\/broadcast\s+(\S+)(?:\s+([\s\S]+))?$/);
    if (!match) {
      await ctx.reply(
        'Usage:\n' +
          '- /broadcast <segment> <text...>\n' +
          '- reply qilib: /broadcast <segment> [caption...]\n' +
          'segment: all | subscribed | not_subscribed | source:<channelId>'
      );
      return;
    }

    const segParsed = parseSegment(match[1]);
    if (!segParsed.ok) {
      await ctx.reply(`Segment xato: ${segParsed.error}`);
      return;
    }

    const maybeText = (match[2] || '').trim();
    const reply = ctx.message?.reply_to_message;
    const isCopyMode = !!reply;

    if (!isCopyMode && !maybeText) {
      await ctx.reply('Matn bo‘sh bo‘lishi mumkin emas (yoki reply qilib yuboring).');
      return;
    }

    const query = await buildUserQuery(segParsed);
    const total = await User.countDocuments(query);
    if (!total) {
      await ctx.reply('Bu segmentda user yo‘q.');
      return;
    }

    const createdByTelegramId = ctx.from?.id;
    const job = isCopyMode
      ? await broadcastService.createCopyJob({
          createdByTelegramId,
          segment: match[1],
          sourceChatId: ctx.chat?.id,
          sourceMessageId: reply.message_id,
          captionOverride: maybeText,
          total
        })
      : await broadcastService.createTextJob({
          createdByTelegramId,
          segment: match[1],
          messageText: maybeText,
          total
        });

    await auditService.logAdminAction(ctx, 'broadcast_create', String(job._id), { segment: match[1], mode: job.mode });

    const runMode = DEFAULT_RUN_MODE;

    if (runMode === 'inline') {
      await broadcastService.touchProgress(job._id, { status: 'running', startedAt: new Date(), workerId: '', lockedAt: null });
      await ctx.reply(`Broadcast (inline) boshlandi. Job: ${job._id}`);
      try {
        await runBroadcastJob({ telegram: ctx.telegram, jobId: job._id });
        const doneJob = await broadcastService.getJob(job._id);
        await ctx.reply(
          `Tugadi. Job=${job._id} Total=${doneJob.total}, sent=${doneJob.sent}, failed=${doneJob.failed}, scanned=${doneJob.scanned}`
        );
      } catch (err) {
        await broadcastService.markFailed(job._id, err?.message || String(err));
        throw err;
      }
      return;
    }

    await ctx.reply(
      `Broadcast queue'ga qo‘yildi. Job: ${job._id}\n` +
        `Mode: ${job.mode}\n` +
        `Worker ishlashi uchun: npm run worker:broadcast\n` +
        `Status: /broadcast_status ${job._id}`
    );
  });

  // Admin-friendly: create draft first
  // /broadcast_prepare <segment> [text...]  (or reply to message + optional caption override)
  bot.command('broadcast_prepare', requireRole('superadmin'), async (ctx) => {
    const fullText = (ctx.message?.text || '').trim();
    const match = fullText.match(/^\/broadcast_prepare\s+(\S+)(?:\s+([\s\S]+))?$/);
    if (!match) {
      await ctx.reply(
        'Usage:\n' +
          '- /broadcast_prepare <segment> <text...>\n' +
          '- reply qilib: /broadcast_prepare <segment> [caption...]\n' +
          'segment: all | subscribed | not_subscribed | source:<channelId>'
      );
      return;
    }

    const segParsed = parseSegment(match[1]);
    if (!segParsed.ok) {
      await ctx.reply(`Segment xato: ${segParsed.error}`);
      return;
    }

    const maybeText = (match[2] || '').trim();
    const reply = ctx.message?.reply_to_message;
    const isCopyMode = !!reply;
    if (!isCopyMode && !maybeText) {
      await ctx.reply('Matn bo‘sh bo‘lishi mumkin emas (yoki reply qilib yuboring).');
      return;
    }

    const query = await buildUserQuery(segParsed);
    const total = await User.countDocuments(query);
    if (!total) {
      await ctx.reply('Bu segmentda user yo‘q.');
      return;
    }

    const createdByTelegramId = ctx.from?.id;
    const job = isCopyMode
      ? await broadcastService.createCopyJob({
          createdByTelegramId,
          segment: match[1],
          sourceChatId: ctx.chat?.id,
          sourceMessageId: reply.message_id,
          captionOverride: maybeText,
          total
        })
      : await broadcastService.createTextJob({
          createdByTelegramId,
          segment: match[1],
          messageText: maybeText,
          total
        });

    await broadcastService.touchProgress(job._id, { status: 'draft' });
    await auditService.logAdminAction(ctx, 'broadcast_prepare', String(job._id), { segment: match[1], mode: job.mode });

    await ctx.reply(
      `Draft tayyor. Job=${job._id}\n` +
        `Segment=${match[1]} Mode=${job.mode} Total=${total}\n` +
        `Confirm: /broadcast_confirm ${job._id}`
    );
  });

  // /broadcast_confirm <jobId>
  bot.command('broadcast_confirm', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('Usage: /broadcast_confirm <jobId>');
      return;
    }

    const jobId = parts[1];
    const job = await broadcastService.getJob(jobId);
    if (!job) {
      await ctx.reply('Job topilmadi.');
      return;
    }

    if (job.status !== 'draft') {
      await ctx.reply(`Bu job draft emas: ${job.status}`);
      return;
    }

    await broadcastService.touchProgress(jobId, { status: 'queued', finishedAt: null, lastError: '' });
    await auditService.logAdminAction(ctx, 'broadcast_confirm', String(jobId), { segment: job.segment, mode: job.mode });

    if (DEFAULT_RUN_MODE === 'inline') {
      await broadcastService.touchProgress(jobId, { status: 'running', startedAt: new Date(), workerId: '', lockedAt: null });
      await ctx.reply(`Broadcast (inline) boshlandi. Job=${jobId}`);
      try {
        await runBroadcastJob({ telegram: ctx.telegram, jobId });
        const doneJob = await broadcastService.getJob(jobId);
        await ctx.reply(
          `Tugadi. Job=${jobId} Total=${doneJob.total}, sent=${doneJob.sent}, failed=${doneJob.failed}, scanned=${doneJob.scanned}`
        );
      } catch (err) {
        await broadcastService.markFailed(jobId, err?.message || String(err));
        throw err;
      }
      return;
    }

    await ctx.reply(`Confirmed. Job queue'da: ${jobId}. Worker: npm run worker:broadcast`);
  });

  // /broadcast_jobs [limit]
  bot.command('broadcast_jobs', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const limit = Math.max(1, Math.min(Number(parts[1] || 10), 30));

    const BroadcastJob = require('../models/BroadcastJob');
    const jobs = await BroadcastJob.find({}, { status: 1, mode: 1, segment: 1, sent: 1, failed: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (!jobs.length) {
      await ctx.reply('Job yo‘q.');
      return;
    }

    await ctx.reply(['So‘nggi broadcast joblar:', ...jobs.map(formatJobLine)].join('\n'));
  });

  // /broadcast_status <jobId>
  bot.command('broadcast_status', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('Usage: /broadcast_status <jobId>');
      return;
    }

    const job = await broadcastService.getJob(parts[1]);
    if (!job) {
      await ctx.reply('Job topilmadi.');
      return;
    }

    await ctx.reply(
      `Job: ${job._id}\n` +
        `Status: ${job.status}\n` +
        `Segment: ${job.segment}\n` +
        `Mode: ${job.mode}\n` +
        `Total: ${job.total}\n` +
        `Progress: scanned=${job.scanned}, sent=${job.sent}, failed=${job.failed}\n` +
        `Started: ${job.startedAt ? new Date(job.startedAt).toISOString() : ''}\n` +
        `Finished: ${job.finishedAt ? new Date(job.finishedAt).toISOString() : ''}`
    );
  });

  // /broadcast_resume <jobId>
  bot.command('broadcast_resume', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('Usage: /broadcast_resume <jobId>');
      return;
    }

    const job = await broadcastService.getJob(parts[1]);
    if (!job) {
      await ctx.reply('Job topilmadi.');
      return;
    }

    if (job.status === 'done') {
      await ctx.reply('Job allaqachon tugagan.');
      return;
    }

    const runMode = (process.env.BROADCAST_RUN_MODE || 'worker').toLowerCase();

    if (runMode !== 'inline') {
      await broadcastService.touchProgress(job._id, { status: 'queued', finishedAt: null, lastError: '' });
      await ctx.reply(`Job qayta queue'ga qo‘yildi. Job=${job._id}. Worker: npm run worker:broadcast`);
      return;
    }

    await broadcastService.touchProgress(job._id, {
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      lastError: '',
      workerId: '',
      lockedAt: null
    });
    await ctx.reply(`Resume (inline) boshlandi. Job=${job._id}`);
    try {
      await runBroadcastJob({ telegram: ctx.telegram, jobId: job._id });
      const doneJob = await broadcastService.getJob(job._id);
      await ctx.reply(
        `Resume tugadi. Job=${job._id} (sent=${doneJob.sent}, failed=${doneJob.failed}, scanned=${doneJob.scanned})`
      );
    } catch (err) {
      await broadcastService.markFailed(job._id, err?.message || String(err));
      throw err;
    }
  });

  // /broadcast_cancel <jobId>
  bot.command('broadcast_cancel', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('Usage: /broadcast_cancel <jobId>');
      return;
    }

    await broadcastService.cancelJob(parts[1]);
    await auditService.logAdminAction(ctx, 'broadcast_cancel', String(parts[1]));
    await ctx.reply('Cancel request yuborildi.');
  });
}

module.exports = { registerBroadcastHandler };
