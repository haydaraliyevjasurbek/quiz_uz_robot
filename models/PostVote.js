const mongoose = require('mongoose');

// One vote per user per message
const postVoteSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, index: true },
    messageId: { type: Number, required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    vote: { type: String, enum: ['up', 'down'], required: true }
  },
  { timestamps: true }
);

postVoteSchema.index({ chatId: 1, messageId: 1, telegramId: 1 }, { unique: true });

module.exports = mongoose.model('PostVote', postVoteSchema);
