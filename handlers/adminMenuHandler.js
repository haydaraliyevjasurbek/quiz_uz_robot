const { Markup } = require('telegraf');

const adminService = require('../services/adminService');

const { onStats } = require('./adminHandler');
const { onResultsAll, onAttemptsTop } = require('./resultsAdminHandler');
const { registerAdminChannelsUi, showAdminChannels } = require('./adminChannelsUi');
const { registerAdminTestsUi, showAdminTests } = require('./adminTestsUi');
const { registerAdminUsersUi, showAdminUsers } = require('./adminUsersUi');
const { registerAdminDirectMessageUi, startAdminDirectMessage } = require('./adminDirectMessageUi');
const { registerAdminRolesUi, showAdminRoles } = require('./adminRolesUi');

function buildAdminPanelInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📣 Kanallar', 'admin_panel:channels'), Markup.button.callback('🧪 Testlar', 'admin_panel:tests')],
    [Markup.button.callback('👥 Userlar ID', 'admin_panel:users'), Markup.button.callback('✉️ Userga yozish', 'admin_panel:dm')],
    [Markup.button.callback('📌 Natijalar', 'admin_panel:results_all'), Markup.button.callback('🏆 Attempts TOP', 'admin_panel:attempts_top')],
    [Markup.button.callback('📈 Statistika', 'admin_panel:stats'), Markup.button.callback('👮 Adminlar (SA)', 'admin_panel:roles')],
    [Markup.button.callback('❌ Yopish', 'admin_panel:close')]
  ]);
}

async function requireAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply('Bu bo‘lim faqat adminlar uchun.');
    return false;
  }
  return true;
}

async function onAdminPanel(ctx) {
  if (!(await requireAdmin(ctx))) return;

  await ctx.reply('🛠 Admin panel — bo‘lim tanlang:', buildAdminPanelInlineKeyboard());
}

function registerAdminMenu(bot) {
  // Must be registered once to support the step-by-step wizard
  registerAdminChannelsUi(bot);
  registerAdminTestsUi(bot);
  registerAdminUsersUi(bot);
  registerAdminDirectMessageUi(bot);
  registerAdminRolesUi(bot);

  bot.hears(['🛠 Admin panel', 'Admin panel'], onAdminPanel);

  bot.action('admin_panel:channels', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await showAdminChannels(ctx);
  });

  bot.action('admin_panel:stats', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await onStats(ctx);
  });

  bot.action('admin_panel:tests', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await showAdminTests(ctx);
  });

  bot.action('admin_panel:users', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await showAdminUsers(ctx, 0);
  });

  bot.action('admin_panel:dm', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startAdminDirectMessage(ctx);
  });

  bot.action('admin_panel:roles', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await showAdminRoles(ctx, 0);
  });

  bot.action('admin_panel:home', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await onAdminPanel(ctx);
  });

  bot.action('admin_panel:results_all', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await onResultsAll(ctx);
  });

  bot.action('admin_panel:attempts_top', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await onAttemptsTop(ctx);
  });

  bot.action('admin_panel:close', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery('Yopildi');
    try {
      await ctx.deleteMessage();
    } catch (_) {
      // ignore
    }
  });
}

module.exports = {
  registerAdminMenu
};
