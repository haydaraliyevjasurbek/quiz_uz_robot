const mongoose = require('mongoose');

/**
 * Admin modeli (roles):
 * - telegramId: unique
 * - role: superadmin | moderator
 */
const adminSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    role: { type: String, enum: ['superadmin', 'moderator'], required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema);
