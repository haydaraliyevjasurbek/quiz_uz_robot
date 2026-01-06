const mongoose = require('mongoose');

// Counts for a specific message (chatId + messageId)
const postReactionSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, index: true },
    messageId: { type: Number, required: true, index: true },
    up: { type: Number, default: 0 },
    down: { type: Number, default: 0 }
  },
  { timestamps: true }
);

postReactionSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model('PostReaction', postReactionSchema);
