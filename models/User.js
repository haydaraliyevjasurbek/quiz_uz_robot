const mongoose = require('mongoose');

/**
 * User modeli:
 * - telegramId: unique
 * - step: foydalanuvchining joriy holati
 * Qo'shimcha maydonlar (active*) quiz davomiy holatini DB’da saqlash uchun.
 */
const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },

    step: { type: String, default: 'idle', index: true },
    joinedAt: { type: Date, default: Date.now },

    // Mandatory Channels
    joinedChannels: { type: [String], default: [], index: true },
    joinedChannelsCheckedAt: { type: Date, default: null },

    // Analytics: user qaysi kanal orqali kelgan (start deep-link payload)
    sourceChannelId: { type: String, default: null, index: true },

    // Quiz session (scalable: in-memory emas, DB’da)
    activeTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', default: null },
    activeQuestionIndex: { type: Number, default: 0 },
    activeQuestionSentAt: { type: Date, default: null },
    activeCorrect: { type: Number, default: 0 },
    activeWrong: { type: Number, default: 0 },

    // Per-question answer history for the current quiz session (used to show review after finish)
    activeAnswers: {
      type: [
        {
          q: { type: Number, required: true },
          chosen: { type: Number, required: true },
          correct: { type: Number, required: true },
          late: { type: Boolean, default: false }
        }
      ],
      default: []
    },

    // Broadcast deliverability
    isBlocked: { type: Boolean, default: false, index: true },
    blockedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
