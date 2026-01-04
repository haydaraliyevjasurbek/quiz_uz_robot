const pino = require('pino');

/**
 * Soddalashtirilgan JSON logger.
 * Prod muhitda loglar agregatorlarga (ELK/Datadog) yuborish uchun qulay.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined
});

module.exports = logger;
