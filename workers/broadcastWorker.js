require('dotenv').config();

const { Telegram } = require('telegraf');

const { connectDB } = require('../config/db');
const logger = require('../utils/logger');
const BroadcastJob = require('../models/BroadcastJob');
const broadcastService = require('../services/broadcastService');
const { runBroadcastJob } = require('../services/broadcastRunner');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextJob(workerId) {
  const now = new Date();
  return BroadcastJob.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', startedAt: now, workerId, lockedAt: now } },
    { sort: { createdAt: 1 }, new: true }
  ).lean();
}

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN .env da topilmadi');

  await connectDB();

  const telegram = new Telegram(token);
  const workerId = process.env.WORKER_ID || `broadcast-worker-${process.pid}`;

  const pollMs = Math.max(250, Number(process.env.BROADCAST_WORKER_POLL_MS || 1000));
  logger.info({ workerId, pollMs }, 'Broadcast worker started');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await claimNextJob(workerId);
      if (!job) {
        await sleep(pollMs);
        continue;
      }

      logger.info({ jobId: job._id, segment: job.segment, mode: job.mode }, 'Broadcast job claimed');

      try {
        const res = await runBroadcastJob({ telegram, jobId: job._id });
        logger.info({ jobId: job._id, canceled: res.canceled, state: res.state }, 'Broadcast job finished');
      } catch (err) {
        await broadcastService.markFailed(job._id, err?.message || String(err));
        logger.error({ err, jobId: job._id }, 'Broadcast job failed');
      }
    } catch (err) {
      logger.error({ err }, 'Worker loop error');
      await sleep(pollMs);
    }
  }
}

module.exports = { main };

// Faqat `node workers/broadcastWorker.js` bilan ishga tushirilsa run qilamiz.
if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'Broadcast worker crashed');
    process.exit(1);
  });
}
