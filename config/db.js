const mongoose = require('mongoose');

const logger = require('../utils/logger');

/**
 * MongoDB ulanishini yaratadi.
 * High-load uchun: minimal logger, serverSelection timeout va pool sozlamalari.
 */
async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI .env da topilmadi');
  }

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(mongoUri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
  });

  // Legacy cleanup:
  // Old versions had a unique index on users.email (email_1). Our User schema has no email,
  // and a non-sparse unique index treats missing values as null -> blocks inserts.
  try {
    const coll = mongoose.connection.collection('users');
    const indexes = await coll.indexes();
    const emailIndex = indexes.find((idx) => idx?.key?.email === 1);
    if (emailIndex) {
      await coll.dropIndex(emailIndex.name);
      logger.warn({ index: emailIndex.name }, 'Dropped legacy users.email index');
    }
  } catch (err) {
    logger.warn({ err }, 'Legacy index cleanup skipped');
  }
}

module.exports = {
  connectDB
};
