const channelService = require('../services/channelService');

// In-memory token bucket (har instansda alohida). High-load cluster uchun Redis tavsiya.
const buckets = new Map();

function nowMs() {
  return Date.now();
}

function getConfig() {
  return {
    perSecond: Number(process.env.RATE_LIMIT_PER_SEC || 3),
    burst: Number(process.env.RATE_LIMIT_BURST || 10)
  };
}

function refill(bucket, perSecond, burst) {
  const now = nowMs();
  const elapsed = (now - bucket.last) / 1000;
  bucket.last = now;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * perSecond);
}

/**
 * Middleware: xabar/callback flood'ni kamaytiradi.
 * Admin bypass.
 */
function rateLimit() {
  return async (ctx, next) => {
    if (!ctx.from) return next();

    // Commandlar throttling sabab "ishlamayapti" bo'lib ko'rinmasin
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text.trim() : '';
    if (text.startsWith('/')) return next();

    // Admin bypass (env ADMIN_IDS)
    if (channelService.isAdminTelegramId(ctx.from.id)) return next();

    const { perSecond, burst } = getConfig();
    const key = String(ctx.from.id);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, last: nowMs() };
      buckets.set(key, bucket);
    }

    refill(bucket, perSecond, burst);

    if (bucket.tokens < 1) {
      // callback bo‘lsa UI osilib qolmasin
      if (ctx.callbackQuery) {
        try {
          await ctx.answerCbQuery('Sekinroq 🙂');
        } catch (_) {
          // ignore
        }
        return;
      }

      // text buyruqlarda ham userga signal beramiz (aks holda "ishlamayapti" bo'lib ko'rinadi)
      try {
        await ctx.reply('Sekinroq. 2-3 soniya kutib qayta urinib ko‘ring.');
      } catch (_) {
        // ignore
      }
      return;
    }

    bucket.tokens -= 1;
    return next();
  };
}

module.exports = rateLimit;
