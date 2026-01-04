const mongoose = require('mongoose');

/**
 * Result modeli:
 * Test yakunlanganda foydalanuvchining natijasini saqlaydi.
 */
const resultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    score: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    completedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Result', resultSchema);
