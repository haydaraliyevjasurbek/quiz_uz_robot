const adminService = require('../services/adminService');
const requireRole = require('../middleware/requireRole');

function formatAdminList(admins) {
  if (!admins.length) return 'Adminlar yo‘q.';
  return admins
    .map((a) => `- ${a.telegramId} (${a.role})`)
    .join('\n');
}

function registerAdminRoleHandlers(bot) {
  // List
  bot.command('admins', requireRole('superadmin'), async (ctx) => {
    const admins = await adminService.listAdmins();
    await ctx.reply(`Adminlar:\n${formatAdminList(admins)}`);
  });

  // Add/update
  // /admin_add <telegramId> <role>
  bot.command('admin_add', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 3) {
      await ctx.reply('Usage: /admin_add <telegramId> <superadmin|moderator>');
      return;
    }

    const telegramId = parts[1];
    const role = parts[2];

    await adminService.upsertAdmin(telegramId, role);
    await ctx.reply(`OK: ${telegramId} -> ${role}`);
  });

  // Delete
  // /admin_del <telegramId>
  bot.command('admin_del', requireRole('superadmin'), async (ctx) => {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('Usage: /admin_del <telegramId>');
      return;
    }

    const telegramId = parts[1];
    const deleted = await adminService.deleteAdmin(telegramId);
    await ctx.reply(deleted ? 'Deleted.' : 'Not found.');
  });
}

module.exports = { registerAdminRoleHandlers };
