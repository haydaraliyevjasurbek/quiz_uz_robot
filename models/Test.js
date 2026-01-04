const mongoose = require('mongoose');

/**
 * Test modeli:
 * - title
 * - questions: savol, variantlar (A-D), correct (0..3 yoki 'A'..'D')
 */
const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: {
      type: [String],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 4,
        message: 'options 4 ta bo‘lishi kerak (A, B, C, D)'
      },
      required: true
    },
    correct: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { _id: false }
);

const testSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    questions: { type: [questionSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Test', testSchema);
