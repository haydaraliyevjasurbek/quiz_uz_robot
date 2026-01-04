const User = require('../models/User');

const channelService = require('../services/channelService');
const adminService = require('../services/adminService');

async function requireModerator(ctx) {
  const telegramId = ctx.from && ctx.from.id;
  if (!telegramId || !(await adminService.hasAtLeastRole(telegramId, 'moderator'))) {
    await ctx.reply(
      `Bu buyruq faqat adminlar (moderator+) uchun.\n` +
        `Sizning Telegram ID: ${telegramId || '(unknown)'}\n` +
        `Admin qilish: superadmin /admin_add ${telegramId} moderator yoki .env ADMIN_IDS ga qo‘shib restart qiling.`
    );
    return false;
  }
  return true;
}

async function onChannels(ctx) {
  if (!(await requireModerator(ctx))) return;

  const channels = await channelService.getAllChannels();
  if (channels.length === 0) {
    await ctx.reply(
      'Hozircha kanal yo‘q.\n\n' +
        'Qo‘shish: /channel_add <channelId> <inviteLink> <title...>\n' +
        'Masalan: /channel_add -1001234567890 https://t.me/yourchannel QUIZ UZ Kanal'
    );
    return;
  }

  const lines = ['📣 Majburiy kanallar:'];
  for (const ch of channels) {
    lines.push(
      `- ${ch.isActive ? '🟢' : '⚫'} ${ch.channelTitle || ''}`.trim() +
        `\n  id: ${ch.channelId}` +
        (ch.inviteLink ? `\n  link: ${ch.inviteLink}` : '')
    );
  }

  await ctx.reply(lines.join('\n'));
}

async function onChannelAdd(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length < 3) {
    await ctx.reply('Format: /channel_add <channelId> <inviteLink> <title...>');
    return;
  }

  const channelId = parts[1];
  const inviteLink = parts[2];
  const channelTitle = parts.slice(3).join(' ');

  await channelService.addChannel({ channelId, inviteLink, channelTitle });
  await ctx.reply('✅ Kanal qo‘shildi. /channels bilan tekshiring.');
}

async function onChannelDel(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length !== 2) {
    await ctx.reply('Format: /channel_del <channelId>');
    return;
  }

  const ok = await channelService.deleteChannel(parts[1]);
  await ctx.reply(ok ? '✅ Kanal o‘chirildi.' : 'Kanal topilmadi.');
}

async function onChannelToggle(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length < 2) {
    await ctx.reply('Format: /channel_toggle <channelId> on|off');
    return;
  }

  const channelId = parts[1];
  const mode = (parts[2] || '').toLowerCase();
  const isActive = mode === 'on' ? true : mode === 'off' ? false : null;
  if (isActive === null) {
    await ctx.reply('Format: /channel_toggle <channelId> on|off');
    return;
  }

  const ok = await channelService.setChannelActive(channelId, isActive);
  await ctx.reply(ok ? '✅ Yangilandi.' : 'Kanal topilmadi.');
}

async function onChannelEdit(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length < 4) {
    await ctx.reply('Format: /channel_edit <channelId> <inviteLink> <title...>');
    return;
  }

  const channelId = parts[1];
  const inviteLink = parts[2];
  const channelTitle = parts.slice(3).join(' ');

  const ok = await channelService.updateChannel(channelId, { inviteLink, channelTitle });
  await ctx.reply(ok ? '✅ Kanal yangilandi.' : 'Kanal topilmadi.');
}

async function onStats(ctx) {
  if (!(await requireModerator(ctx))) return;

  const stats = await channelService.buildLiveStats();

  const lines = [];
  lines.push('📊 Statistika (DB bo‘yicha)');
  lines.push(`Jami userlar (unique telegramId): ${stats.totalUsers}`);
  lines.push(`Aktiv kanallar: ${stats.activeChannelsCount}/${stats.allChannelsCount}`);
  lines.push(`To‘liq a’zo (aktiv kanallar bo‘yicha): ${stats.fullySubscribed}`);
  lines.push('Eslatma: bu sonlar userlarning oxirgi tekshiruv natijalari (joinedChannels) bo‘yicha.');

  lines.push('');
  lines.push('Har kanal bo‘yicha a’zolar:');
  for (const ch of stats.perChannel) {
    lines.push(`- ${ch.title}: ${ch.count}`);
  }

  lines.push('');
  lines.push('Qaysi kanal orqali kelgan (start deep-link):');
  if (!stats.sourceAgg || stats.sourceAgg.length === 0) {
    lines.push('- (ma’lumot yo‘q)');
  } else {
    for (const row of stats.sourceAgg.slice(0, 20)) {
      lines.push(`- ${row._id || '(unknown)'}: ${row.count}`);
    }
  }

  await ctx.reply(lines.join('\n'));
}

async function onUserChannels(ctx) {
  if (!(await requireModerator(ctx))) return;

  const text = ctx.message && ctx.message.text ? ctx.message.text : '';
  const parts = text.split(' ').filter(Boolean);
  if (parts.length !== 2) {
    await ctx.reply('Format: /user_channels <telegramId>');
    return;
  }

  const telegramId = Number(parts[1]);
  if (!Number.isFinite(telegramId)) {
    await ctx.reply('telegramId raqam bo‘lishi kerak.');
    return;
  }

  const user = await User.findOne({ telegramId }, { telegramId: 1, username: 1, joinedChannels: 1, joinedChannelsCheckedAt: 1, sourceChannelId: 1 }).lean();
  if (!user) {
    await ctx.reply('User topilmadi.');
    return;
  }

  const channels = await channelService.getAllChannels();
  const joined = new Set(user.joinedChannels || []);

  const lines = [];
  lines.push(`👤 User: ${user.telegramId} @${user.username || ''}`.trim());
  lines.push(`Source: ${user.sourceChannelId || '(unknown)'}`);
  lines.push(`Last check: ${user.joinedChannelsCheckedAt ? new Date(user.joinedChannelsCheckedAt).toISOString() : '(never)'}`);
  lines.push('');
  lines.push('Kanallar:');
  for (const ch of channels) {
    lines.push(`- ${joined.has(ch.channelId) ? '✅' : '❌'} ${ch.channelTitle || ch.channelId}`);
  }

  await ctx.reply(lines.join('\n'));
}

module.exports = {
  onChannels,
  onChannelAdd,
  onChannelDel,
  onChannelToggle,
  onChannelEdit,
  onStats,
  onUserChannels
};
