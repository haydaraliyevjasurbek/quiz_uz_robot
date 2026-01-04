const mongoose = require('mongoose');

const broadcastJobSchema = new mongoose.Schema(
  {
    createdByTelegramId: { type: Number, required: true, index: true },

    // original command inputs
    segment: { type: String, required: true },
    mode: { type: String, enum: ['text', 'copy'], required: true, default: 'text' },
    messageText: { type: String, default: '' },

    // copy-mode source
    sourceChatId: { type: Number, default: null },
    sourceMessageId: { type: Number, default: null },
    captionOverride: { type: String, default: '' },

    // progress
    status: {
      type: String,
      enum: ['draft', 'queued', 'running', 'done', 'failed', 'canceled'],
      default: 'queued',
      index: true
    },
    total: { type: Number, default: 0 },
    scanned: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },

    // resume cursor
    lastUserObjectId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },

    // worker fields
    workerId: { type: String, default: '' },
    lockedAt: { type: Date, default: null },

    lastError: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('BroadcastJob', broadcastJobSchema);
