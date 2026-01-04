const BroadcastJob = require('../models/BroadcastJob');

async function createJob({ createdByTelegramId, segment, messageText, total }) {
  return BroadcastJob.create({
    createdByTelegramId,
    segment,
    mode: 'text',
    messageText,
    total: Number(total || 0),
    status: 'queued',
    startedAt: null
  });
}

async function createTextJob({ createdByTelegramId, segment, messageText, total }) {
  return BroadcastJob.create({
    createdByTelegramId,
    segment,
    mode: 'text',
    messageText: String(messageText || ''),
    total: Number(total || 0),
    status: 'queued',
    startedAt: null
  });
}

async function createCopyJob({ createdByTelegramId, segment, sourceChatId, sourceMessageId, captionOverride, total }) {
  return BroadcastJob.create({
    createdByTelegramId,
    segment,
    mode: 'copy',
    sourceChatId: Number(sourceChatId),
    sourceMessageId: Number(sourceMessageId),
    captionOverride: String(captionOverride || ''),
    total: Number(total || 0),
    status: 'queued',
    startedAt: null
  });
}

async function getJob(jobId) {
  return BroadcastJob.findById(jobId).lean();
}

async function touchProgress(jobId, patch) {
  await BroadcastJob.updateOne({ _id: jobId }, { $set: patch });
}

async function incProgress(jobId, inc, set) {
  const update = {};
  if (inc && Object.keys(inc).length) update.$inc = inc;
  if (set && Object.keys(set).length) update.$set = set;
  if (!Object.keys(update).length) return;
  await BroadcastJob.updateOne({ _id: jobId }, update);
}

async function markDone(jobId, patch) {
  await BroadcastJob.updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'done',
        finishedAt: new Date(),
        ...(patch || {})
      }
    }
  );
}

async function markFailed(jobId, errorMessage) {
  await BroadcastJob.updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'failed',
        finishedAt: new Date(),
        lastError: String(errorMessage || '').slice(0, 1000)
      }
    }
  );
}

async function cancelJob(jobId) {
  await BroadcastJob.updateOne(
    { _id: jobId },
    {
      $set: {
        status: 'canceled',
        finishedAt: new Date()
      }
    }
  );
}

module.exports = {
  createJob,
  createTextJob,
  createCopyJob,
  getJob,
  touchProgress,
  incProgress,
  markDone,
  markFailed,
  cancelJob
};
