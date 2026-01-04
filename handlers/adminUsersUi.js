const { Markup } = require('telegraf');

const User = require('../models/User');
const adminService = require('../services/adminService');

const PAGE_SIZE = Math.min(Math.max(Number(process.env.ADMIN_USERS_PAGE_SIZE || 30), 5), 50);

async function requireAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply('Bu bo‘lim faqat adminlar uchun.');
    return false;
  }
  return true;
}

function formatUserLine(u) {
  const id = u.telegramId;
  const username = u.username ? `@${u.username}` : '';
  const firstName = u.firstName ? String(u.firstName).trim() : '';
  const extra = [username, firstName].filter(Boolean).join(' ');
  return `- ${id}${extra ? ` (${extra})` : ''}`;
}

function usersKb(page, total) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const buttons = [];

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `admin_u:list:${page - 1}`));
  if (page < maxPage) nav.push(Markup.button.callback('➡️ Keyingi', `admin_u:list:${page + 1}`));
  if (nav.length) buttons.push(nav);

  buttons.push([Markup.button.callback('⬅️ Admin panel', 'admin_panel:home')]);
  buttons.push([Markup.button.callback('❌ Yopish', 'admin_u:close')]);

  return Markup.inlineKeyboard(buttons);
}

async function showAdminUsers(ctx, page) {
  if (!(await requireAdmin(ctx))) return;

  const safePage = Number.isFinite(Number(page)) ? Math.max(0, Number(page)) : 0;

  const filter = { telegramId: { $ne: null } };
  const total = await User.countDocuments(filter);

  const users = await User.find(filter, { telegramId: 1, username: 1, firstName: 1, joinedAt: 1 })
    .sort({ joinedAt: -1, telegramId: -1 })
    .skip(safePage * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean();

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const p = Math.min(safePage, maxPage);

  const lines = [`👥 Userlar (Telegram ID)`, `Jami: ${total}`, `Sahifa: ${p + 1}/${maxPage + 1}`, ''];

  if (!users.length) {
    lines.push('Hozircha user yo‘q.');
  } else {
    for (const u of users) lines.push(formatUserLine(u));
  }

  await ctx.reply(lines.join('\n'), usersKb(p, total));
}

function registerAdminUsersUi(bot) {
  bot.action('admin_u:close', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery('Yopildi');
    try {
      await ctx.deleteMessage();
    } catch (_) {
      // ignore
    }
  });

  bot.action(/admin_u:list:(\d+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const data = String(ctx.callbackQuery?.data || '');
    const m = data.match(/^admin_u:list:(\d+)$/);
    const page = m ? Number(m[1]) : 0;
    await ctx.answerCbQuery();
    await showAdminUsers(ctx, page);
  });
}

module.exports = {
  registerAdminUsersUi,
  showAdminUsers
};
