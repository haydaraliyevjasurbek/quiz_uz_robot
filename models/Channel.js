const mongoose = require('mongoose');

/**
 * Channel modeli (Mandatory Channels):
 * - channelId: Telegram chat/channel ID (odatda -100...)
 * - channelTitle: ko‘rinadigan nom
 * - inviteLink: https://t.me/... yoki invite link
 * - isActive: tekshiruvda qatnashadimi
 */
const channelSchema = new mongoose.Schema(
  {
    channelId: { type: String, required: true, unique: true, index: true },
    channelTitle: { type: String, default: '' },
    inviteLink: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Channel', channelSchema);
