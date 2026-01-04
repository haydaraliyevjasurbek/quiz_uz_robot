const { Markup } = require('telegraf');

const channelService = require('../services/channelService');
const adminService = require('../services/adminService');

// In-memory per-admin wizard state
// Keyed by telegramId to keep it simple.
const wizardState = new Map();

function getKey(ctx) {
  return ctx.from?.id;
}

function setState(telegramId, state) {
  wizardState.set(telegramId, state);
}

function getState(telegramId) {
  return wizardState.get(telegramId);
}

function clearState(telegramId) {
  wizardState.delete(telegramId);
}

async function requireAdmin(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply('Bu bo‘lim faqat adminlar uchun.');
    return false;
  }
  return true;
}

function cancelKb() {
  return Markup.inlineKeyboard([Markup.button.callback('❌ Bekor qilish', 'admin_ch:cancel')]);
}

function normalizeInviteLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  if (s.startsWith('@')) {
    const username = s.slice(1).trim();
    return username ? `https://t.me/${username}` : '';
  }

  if (s.startsWith('t.me/') || s.startsWith('telegram.me/')) {
    return `https://${s}`;
  }

  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('tg://')) {
    return s;
  }

  if (/^[a-zA-Z0-9_]{5,}$/.test(s)) {
    return `https://t.me/${s}`;
  }

  return s;
}

function isValidButtonUrl(url) {
  if (!url) return false;
  if (url.startsWith('tg://')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isValidChannelIdOrUsername(s) {
  const v = String(s || '').trim();
  if (!v) return false;
  // -1001234567890 (supergroup/channel) or numeric id
  if (/^-?\d{5,}$/.test(v)) return true;
  // @channel_username
  if (/^@[a-zA-Z0-9_]{5,}$/.test(v)) return true;
  return false;
}

function validateTitle(s) {
  const v = String(s || '').trim();
  if (!v) return { ok: false, error: 'Kanal nomi (title) bo‘sh bo‘lmasin.' };
  if (v.length < 3) return { ok: false, error: 'Kanal nomi juda qisqa (kamida 3 ta belgi).' };
  if (v.length > 80) return { ok: false, error: 'Kanal nomi juda uzun (maks 80 ta belgi).' };
  return { ok: true, value: v };
}

function channelsMainKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Kanal qo‘shish', 'admin_ch:add'), Markup.button.callback('✏️ Tahrirlash', 'admin_ch:edit')],
    [Markup.button.callback('🗑 O‘chirish', 'admin_ch:del'), Markup.button.callback('🟢/⚫ Yoqish-o‘chirish', 'admin_ch:toggle')],
    [Markup.button.callback('🔄 Yangilash', 'admin_ch:refresh')]
  ]);
}

async function renderChannelsList(ctx) {
  const channels = await channelService.getAllChannels();
  if (!channels.length) {
    await ctx.reply('📣 Majburiy kanallar: (hozircha yo‘q)\n\nQuyidan kanal qo‘shing:', channelsMainKb());
    return;
  }

  const lines = ['📣 Majburiy kanallar:'];
  for (const ch of channels) {
    lines.push(
      `- ${ch.isActive ? '🟢' : '⚫'} ${ch.channelTitle || ''}`.trim() +
        `\n  id: ${ch.channelId}` +
        (ch.inviteLink ? `\n  link: ${ch.inviteLink}` : '')
    );
    lines.push('');
  }

  await ctx.reply(lines.join('\n').trim(), channelsMainKb());
}

async function showAdminChannels(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const telegramId = getKey(ctx);
  if (telegramId) clearState(telegramId);
  await renderChannelsList(ctx);
}

async function startAddFlow(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const telegramId = getKey(ctx);
  if (!telegramId) return;

  setState(telegramId, { mode: 'add', step: 'channelId', data: {} });
  await ctx.reply('➕ Kanal qo‘shish\n\n1/3: Kanal ID yuboring (misol: -100123... yoki @username):', cancelKb());
}

async function startEditPick(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const channels = await channelService.getAllChannels();
  if (!channels.length) {
    await ctx.reply('Tahrirlash uchun kanal yo‘q.', channelsMainKb());
    return;
  }

  const buttons = channels.slice(0, 30).map((ch) => [Markup.button.callback(`${ch.isActive ? '🟢' : '⚫'} ${ch.channelTitle || ch.channelId}`, `admin_ch:edit_pick:${encodeURIComponent(ch.channelId)}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'admin_ch:back')]);

  await ctx.reply('✏️ Qaysi kanalni tahrirlaymiz?', Markup.inlineKeyboard(buttons));
}

async function startDeletePick(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const channels = await channelService.getAllChannels();
  if (!channels.length) {
    await ctx.reply('O‘chirish uchun kanal yo‘q.', channelsMainKb());
    return;
  }

  const buttons = channels.slice(0, 30).map((ch) => [Markup.button.callback(`${ch.isActive ? '🟢' : '⚫'} ${ch.channelTitle || ch.channelId}`, `admin_ch:del_pick:${encodeURIComponent(ch.channelId)}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'admin_ch:back')]);

  await ctx.reply('🗑 Qaysi kanalni o‘chiramiz?', Markup.inlineKeyboard(buttons));
}

async function startTogglePick(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const channels = await channelService.getAllChannels();
  if (!channels.length) {
    await ctx.reply('Toggle uchun kanal yo‘q.', channelsMainKb());
    return;
  }

  const buttons = channels.slice(0, 30).map((ch) => [Markup.button.callback(`${ch.isActive ? '🟢' : '⚫'} ${ch.channelTitle || ch.channelId}`, `admin_ch:toggle_pick:${encodeURIComponent(ch.channelId)}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'admin_ch:back')]);

  await ctx.reply('🟢/⚫ Qaysi kanalni yoqamiz/o‘chiramiz?', Markup.inlineKeyboard(buttons));
}

async function onTextDuringWizard(ctx) {
  const telegramId = getKey(ctx);
  if (!telegramId) return false;

  const state = getState(telegramId);
  if (!state) return false;

  const text = (ctx.message?.text || '').trim();
  if (!text) return true;

  // Let slash-commands pass through (unless you want to cancel wizard via /cancel)
  if (text.startsWith('/')) {
    if (text === '/cancel') {
      clearState(telegramId);
      await ctx.reply('Bekor qilindi. Admin panel → Kanallar orqali davom eting.');
      return true;
    }
    return false;
  }

  if (state.mode === 'add') {
    if (state.step === 'channelId') {
      if (!isValidChannelIdOrUsername(text)) {
        await ctx.reply(
          '❌ Kanal ID noto‘g‘ri.\nMisol: -1001234567890 yoki @it_zona_one\nQayta yuboring:',
          cancelKb()
        );
        return true;
      }

      state.data.channelId = text;
      state.step = 'inviteLink';
      setState(telegramId, state);
      await ctx.reply('2/3: Invite link yuboring (misol: https://t.me/yourchannel):', cancelKb());
      return true;
    }

    if (state.step === 'inviteLink') {
      const normalized = normalizeInviteLink(text);
      if (!isValidButtonUrl(normalized)) {
        await ctx.reply(
          '❌ Invite link noto‘g‘ri.\nTo‘g‘ri format: https://t.me/kanal yoki @kanal_username\nQayta yuboring:',
          cancelKb()
        );
        return true;
      }

      state.data.inviteLink = normalized;
      state.step = 'title';
      setState(telegramId, state);
      await ctx.reply('3/3: Kanal nomini yuboring (title):', cancelKb());
      return true;
    }

    if (state.step === 'title') {
      const vt = validateTitle(text);
      if (!vt.ok) {
        await ctx.reply(`❌ ${vt.error}\nQayta yuboring:`, cancelKb());
        return true;
      }

      state.data.channelTitle = vt.value;
      const { channelId, inviteLink, channelTitle } = state.data;

      try {
        await channelService.addChannel({ channelId, inviteLink, channelTitle });
        clearState(telegramId);
        await ctx.reply('✅ Kanal qo‘shildi.');
        await renderChannelsList(ctx);
      } catch (e) {
        await ctx.reply(`Xatolik: ${e.message || 'Kanal qo‘shib bo‘lmadi.'}`);
      }
      return true;
    }
  }

  if (state.mode === 'edit') {
    if (state.step === 'inviteLink') {
      const normalized = normalizeInviteLink(text);
      if (!isValidButtonUrl(normalized)) {
        await ctx.reply(
          '❌ Invite link noto‘g‘ri.\nTo‘g‘ri format: https://t.me/kanal yoki @kanal_username\nQayta yuboring:',
          cancelKb()
        );
        return true;
      }

      state.data.inviteLink = normalized;
      state.step = 'title';
      setState(telegramId, state);
      await ctx.reply('2/2: Yangi title yuboring:', cancelKb());
      return true;
    }

    if (state.step === 'title') {
      const vt = validateTitle(text);
      if (!vt.ok) {
        await ctx.reply(`❌ ${vt.error}\nQayta yuboring:`, cancelKb());
        return true;
      }

      state.data.channelTitle = vt.value;
      const { channelId, inviteLink, channelTitle } = state.data;

      try {
        const ok = await channelService.updateChannel(channelId, { inviteLink, channelTitle });
        clearState(telegramId);
        await ctx.reply(ok ? '✅ Kanal yangilandi.' : 'Kanal topilmadi.');
        await renderChannelsList(ctx);
      } catch (e) {
        await ctx.reply(`Xatolik: ${e.message || 'Kanal yangilanmadi.'}`);
      }
      return true;
    }
  }

  return true;
}

function registerAdminChannelsUi(bot) {
  // Wizard text capture
  bot.on('text', async (ctx, next) => {
    try {
      const handled = await onTextDuringWizard(ctx);
      if (handled) return;
    } catch (_) {
      // ignore and pass through
    }
    return next();
  });

  // Actions
  bot.action('admin_ch:refresh', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery('Yangilandi');
    await renderChannelsList(ctx);
  });

  bot.action('admin_ch:back', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await renderChannelsList(ctx);
  });

  bot.action('admin_ch:cancel', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const telegramId = getKey(ctx);
    if (telegramId) clearState(telegramId);
    await ctx.answerCbQuery('Bekor qilindi');
    await renderChannelsList(ctx);
  });

  bot.action('admin_ch:add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startAddFlow(ctx);
  });

  bot.action('admin_ch:edit', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startEditPick(ctx);
  });

  bot.action(/admin_ch:edit_pick:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const telegramId = getKey(ctx);
    if (!telegramId) return;

    const channelId = decodeURIComponent(ctx.match[1]);
    setState(telegramId, { mode: 'edit', step: 'inviteLink', data: { channelId } });
    await ctx.reply(`✏️ Tahrirlash (${channelId})\n\n1/2: Yangi invite link yuboring:`, cancelKb());
  });

  bot.action('admin_ch:del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startDeletePick(ctx);
  });

  bot.action(/admin_ch:del_pick:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const channelId = decodeURIComponent(ctx.match[1]);

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Ha, o‘chirish', `admin_ch:del_confirm:${encodeURIComponent(channelId)}`)],
      [Markup.button.callback('⬅️ Orqaga', 'admin_ch:back')]
    ]);

    await ctx.reply(`🗑 Kanalni o‘chiramizmi?\n${channelId}`, kb);
  });

  bot.action(/admin_ch:del_confirm:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const channelId = decodeURIComponent(ctx.match[1]);

    const ok = await channelService.deleteChannel(channelId);
    await ctx.reply(ok ? '✅ Kanal o‘chirildi.' : 'Kanal topilmadi.');
    await renderChannelsList(ctx);
  });

  bot.action('admin_ch:toggle', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startTogglePick(ctx);
  });

  bot.action(/admin_ch:toggle_pick:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const channelId = decodeURIComponent(ctx.match[1]);

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🟢 ON', `admin_ch:toggle_set:${encodeURIComponent(channelId)}:on`), Markup.button.callback('⚫ OFF', `admin_ch:toggle_set:${encodeURIComponent(channelId)}:off`)],
      [Markup.button.callback('⬅️ Orqaga', 'admin_ch:back')]
    ]);

    await ctx.reply(`🟢/⚫ Toggle (${channelId})`, kb);
  });

  bot.action(/admin_ch:toggle_set:(.+):(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const channelId = decodeURIComponent(ctx.match[1]);
    const mode = String(ctx.match[2] || '').toLowerCase();
    const isActive = mode === 'on' ? true : mode === 'off' ? false : null;

    if (isActive === null) {
      await ctx.reply('Noto‘g‘ri tanlov.');
      return;
    }

    const ok = await channelService.setChannelActive(channelId, isActive);
    await ctx.reply(ok ? '✅ Yangilandi.' : 'Kanal topilmadi.');
    await renderChannelsList(ctx);
  });
}

module.exports = {
  registerAdminChannelsUi,
  showAdminChannels
};
