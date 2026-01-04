const adminService = require('../services/adminService');

function requireRole(minRole) {
  return async (ctx, next) => {
    const telegramId = ctx.from?.id;
    const ok = await adminService.hasAtLeastRole(telegramId, minRole);
    if (!ok) {
      await ctx.reply('Ruxsat yo‘q.');
      return;
    }
    return next();
  };
}

module.exports = requireRole;
