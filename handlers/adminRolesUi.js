const { Markup } = require('telegraf');

const adminService = require('../services/adminService');

const PAGE_SIZE = Math.min(Math.max(Number(process.env.ADMIN_ROLES_PAGE_SIZE || 15), 5), 30);

// In-memory state for adding admin: superadminId -> { stage: 'await_id' }
const addState = new Map();

async function requireSuperadmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'superadmin'))) {
    try {
      await ctx.reply('Bu bo‘lim faqat superadminlar uchun.');
    } catch (_) {
      // ignore
    }
    return false;
  }
  return true;
}

function parseTelegramId(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function rolesKb({ page, total }) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const buttons = [];

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Oldingi', `admin_r:list:${page - 1}`));
  if (page < maxPage) nav.push(Markup.button.callback('➡️ Keyingi', `admin_r:list:${page + 1}`));
  if (nav.length) buttons.push(nav);

  buttons.push([Markup.button.callback('➕ Admin qo‘shish', 'admin_r:add')]);
  buttons.push([Markup.button.callback('⬅️ Admin panel', 'admin_panel:home')]);
  buttons.push([Markup.button.callback('❌ Yopish', 'admin_r:close')]);

  return Markup.inlineKeyboard(buttons);
}

function addKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Bekor qilish', 'admin_r:add_cancel')],
    [Markup.button.callback('⬅️ Orqaga', 'admin_r:list:0')]
  ]);
}

async function showAdminRoles(ctx, page) {
  if (!(await requireSuperadmin(ctx))) return;

  const safePage = Number.isFinite(Number(page)) ? Math.max(0, Number(page)) : 0;

  const admins = await adminService.listAdmins();
  const total = admins.length;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const p = Math.min(safePage, maxPage);

  const slice = admins.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const lines = ['👮 Adminlar', `Jami: ${total}`, `Sahifa: ${p + 1}/${maxPage + 1}`, ''];

  if (!slice.length) {
    lines.push('Hozircha admin yo‘q.');
  } else {
    for (const a of slice) {
      const id = a.telegramId;
      const role = a.role;
      lines.push(`- ${id} (${role})`);

      // Per-admin quick actions
      // 1st row: set role
      // 2nd row: delete
      // NOTE: callback data length is limited; IDs are numeric and small.
      const kb = Markup.inlineKeyboard([
        [
          Markup.button.callback('⬆️ Moderator', `admin_r:set:${id}:moderator`),
          Markup.button.callback('⭐ Superadmin', `admin_r:set:${id}:superadmin`)
        ],
        [Markup.button.callback('🗑 O‘chirish', `admin_r:del:${id}`)]
      ]);

      // Send as separate message per admin entry to keep buttons simple and avoid keyboard limits.
      await ctx.reply(`ID: ${id}\nRole: ${role}`, kb);
    }
  }

  await ctx.reply('🔽 Boshqaruv:', rolesKb({ page: p, total }));
}

async function startAddAdmin(ctx) {
  if (!(await requireSuperadmin(ctx))) return;

  const superId = ctx.from?.id;
  if (!superId) return;

  addState.set(superId, { stage: 'await_id' });

  await ctx.reply('➕ Admin qo‘shish\n\nTelegram ID yuboring (faqat raqam):', addKb());
}

async function cancelAddAdmin(ctx) {
  if (!(await requireSuperadmin(ctx))) return;
  const superId = ctx.from?.id;
  if (superId) addState.delete(superId);
  try {
    await ctx.answerCbQuery('Bekor qilindi');
  } catch (_) {
    // ignore
  }
  await ctx.reply('Bekor qilindi.', rolesKb({ page: 0, total: (await adminService.listAdmins()).length }));
}

async function onAnyMessage(ctx, next) {
  const superId = ctx.from?.id;
  if (!superId) return next();

  const state = addState.get(superId);
  if (!state) return next();

  if (!(await adminService.hasAtLeastRole(superId, 'superadmin'))) {
    addState.delete(superId);
    return next();
  }

  if (!ctx.message) return next();

  const text = typeof ctx.message.text === 'string' ? ctx.message.text : '';
  const id = parseTelegramId(text);
  if (!id) {
    await ctx.reply('❌ ID noto‘g‘ri. Telegram ID ni raqam ko‘rinishida yuboring:', addKb());
    return;
  }

  // Default role: moderator
  try {
    await adminService.upsertAdmin(id, 'moderator');
    await ctx.reply(`✅ Qo‘shildi: ${id} -> moderator`);
  } catch (e) {
    await ctx.reply('❌ Qo‘shib bo‘lmadi. Qayta urinib ko‘ring.');
  } finally {
    addState.delete(superId);
  }

  await showAdminRoles(ctx, 0);
}

function registerAdminRolesUi(bot) {
  bot.action('admin_r:close', async (ctx) => {
    if (!(await requireSuperadmin(ctx))) return;
    await ctx.answerCbQuery('Yopildi');
    try {
      await ctx.deleteMessage();
    } catch (_) {
      // ignore
    }
  });

  bot.action(/admin_r:list:(\d+)/, async (ctx) => {
    if (!(await requireSuperadmin(ctx))) return;
    const data = String(ctx.callbackQuery?.data || '');
    const m = data.match(/^admin_r:list:(\d+)$/);
    const page = m ? Number(m[1]) : 0;
    await ctx.answerCbQuery();
    await showAdminRoles(ctx, page);
  });

  bot.action('admin_r:add', async (ctx) => {
    await ctx.answerCbQuery();
    await startAddAdmin(ctx);
  });

  bot.action('admin_r:add_cancel', async (ctx) => {
    await cancelAddAdmin(ctx);
  });

  bot.action(/admin_r:set:(\d+):(moderator|superadmin)/, async (ctx) => {
    if (!(await requireSuperadmin(ctx))) return;
    const data = String(ctx.callbackQuery?.data || '');
    const m = data.match(/^admin_r:set:(\d+):(moderator|superadmin)$/);
    if (!m) return;

    const id = Number(m[1]);
    const role = m[2];

    try {
      await adminService.upsertAdmin(id, role);
      await ctx.answerCbQuery('OK');
    } catch (e) {
      await ctx.answerCbQuery('Xatolik');
    }
  });

  bot.action(/admin_r:del:(\d+)/, async (ctx) => {
    if (!(await requireSuperadmin(ctx))) return;
    const data = String(ctx.callbackQuery?.data || '');
    const m = data.match(/^admin_r:del:(\d+)$/);
    const id = m ? m[1] : null;
    if (!id) return;

    await ctx.answerCbQuery();
    await ctx.reply(
      `🗑 Adminni o‘chirish\n\nID: ${id}\nRostdan ham o‘chiramizmi?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, o‘chirish', `admin_r:del_confirm:${id}`)],
        [Markup.button.callback('❌ Yo‘q', 'admin_r:list:0')]
      ])
    );
  });

  bot.action(/admin_r:del_confirm:(\d+)/, async (ctx) => {
    if (!(await requireSuperadmin(ctx))) return;
    const data = String(ctx.callbackQuery?.data || '');
    const m = data.match(/^admin_r:del_confirm:(\d+)$/);
    const id = m ? m[1] : null;
    if (!id) return;

    try {
      const deleted = await adminService.deleteAdmin(id);
      await ctx.answerCbQuery(deleted ? 'Deleted' : 'Not found');
    } catch (e) {
      await ctx.answerCbQuery('Xatolik');
    }

    await showAdminRoles(ctx, 0);
  });

  // Capture messages for add-admin wizard
  bot.on('message', onAnyMessage);
}

module.exports = {
  registerAdminRolesUi,
  showAdminRoles
};
