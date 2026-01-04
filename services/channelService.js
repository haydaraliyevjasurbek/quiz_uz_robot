const { Markup } = require('telegraf');

const Channel = require('../models/Channel');
const User = require('../models/User');
const logger = require('../utils/logger');

// Kichik TTL cache: DB'ni har update uchun urmaslik (har instansda alohida).
let cachedActiveChannels = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;
const SUB_CHECK_TTL_MS = Number(process.env.SUB_CHECK_TTL_MS || 120_000);

function isFresh(date) {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < SUB_CHECK_TTL_MS;
}

function hasAllActive(joinedChannels, activeChannels) {
  const joined = new Set(Array.isArray(joinedChannels) ? joinedChannels : []);
  for (const ch of activeChannels) {
    if (!joined.has(ch.channelId)) return false;
  }
  return true;
}

function parseAdminIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function isAdminTelegramId(telegramId) {
  const admins = parseAdminIds();
  return admins.includes(Number(telegramId));
}

function isMemberStatus(status) {
  // Telegram statuses: creator/administrator/member/restricted/left/kicked
  return status === 'creator' || status === 'administrator' || status === 'member';
}

function normalizeInviteLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  // Common admin input: @channel_username
  if (s.startsWith('@')) {
    const username = s.slice(1).trim();
    return username ? `https://t.me/${username}` : '';
  }

  // Common admin input: t.me/<something>
  if (s.startsWith('t.me/') || s.startsWith('telegram.me/')) {
    return `https://${s}`;
  }

  // Already a URL or tg deep-link
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('tg://')) {
    return s;
  }

  // If they paste only username without @
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

async function getActiveChannels() {
  const now = Date.now();
  if (cachedActiveChannels && now - cachedAt < CACHE_TTL_MS) return cachedActiveChannels;

  cachedActiveChannels = await Channel.find({ isActive: true }, { channelId: 1, channelTitle: 1, inviteLink: 1 })
    .sort({ createdAt: 1 })
    .lean();
  cachedAt = now;
  return cachedActiveChannels;
}

async function getAllChannels() {
  return Channel.find({}, { channelId: 1, channelTitle: 1, inviteLink: 1, isActive: 1 })
    .sort({ createdAt: 1 })
    .lean();
}

async function addChannel({ channelId, inviteLink, channelTitle }) {
  const doc = await Channel.create({
    channelId: String(channelId),
    inviteLink: normalizeInviteLink(inviteLink),
    channelTitle: channelTitle || '',
    isActive: true
  });
  cachedActiveChannels = null;
  return doc;
}

async function deleteChannel(channelId) {
  const res = await Channel.deleteOne({ channelId: String(channelId) });
  cachedActiveChannels = null;
  return res.deletedCount === 1;
}

async function setChannelActive(channelId, isActive) {
  const res = await Channel.updateOne({ channelId: String(channelId) }, { $set: { isActive: !!isActive } });
  cachedActiveChannels = null;
  return res.matchedCount === 1;
}

async function updateChannel(channelId, patch) {
  const $set = {};
  if (typeof patch.channelTitle === 'string') $set.channelTitle = patch.channelTitle;
  if (typeof patch.inviteLink === 'string') $set.inviteLink = normalizeInviteLink(patch.inviteLink);

  const res = await Channel.updateOne({ channelId: String(channelId) }, { $set });
  cachedActiveChannels = null;
  return res.matchedCount === 1;
}

function buildSubscriptionKeyboard(channels) {
  const rows = [];

  for (const ch of channels) {
    const title = ch.channelTitle || ch.channelId;
    const url = normalizeInviteLink(ch.inviteLink);
    if (isValidButtonUrl(url)) {
      rows.push([Markup.button.url(`➕ ${title}`, url)]);
    } else {
      // inviteLink bo‘lmasa ham, admin keyin qo‘shib qo‘yadi
      rows.push([Markup.button.callback(`➕ ${title}`, 'noop')]);
    }
  }

  rows.push([Markup.button.callback('✅ Tekshirish', 'check_sub')]);
  return Markup.inlineKeyboard(rows);
}

async function sendSubscriptionPrompt(ctx, channels) {
  if (!channels || channels.length === 0) return;

  const textLines = [
    'Testlarni yechish uchun quyidagi kanallarga a’zo bo‘ling:',
    '',
    ...channels.map((ch, i) => `${i + 1}) ${ch.channelTitle || ch.channelId}`),
    '',
    'A’zo bo‘lgach, ✅ Tekshirish tugmasini bosing.'
  ];

  await ctx.reply(textLines.join('\n'), buildSubscriptionKeyboard(channels));
}

/**
 * Foydalanuvchining majburiy kanallarga a’zoligini tekshiradi va DB'ga yozadi.
 * Scalable: holat DB’da (joinedChannels) saqlanadi; instanslararo mos.
 */
async function checkAndUpdateUserChannels(ctx) {
  const telegramId = ctx.from && ctx.from.id;
  if (!telegramId) return { ok: true, channels: [], joinedChannelIds: [] };

  const channels = await getActiveChannels();
  if (channels.length === 0) return { ok: true, channels, joinedChannelIds: [] };

  // High-load optimizatsiya: yaqinda tekshirilgan bo‘lsa qayta API chaqirmaymiz
  const existing = await User.findOne(
    { telegramId },
    { joinedChannels: 1, joinedChannelsCheckedAt: 1 }
  ).lean();

  if (existing && isFresh(existing.joinedChannelsCheckedAt) && hasAllActive(existing.joinedChannels, channels)) {
    return { ok: true, channels, joinedChannelIds: existing.joinedChannels };
  }

  const joinedChannelIds = [];
  const membership = [];

  for (const ch of channels) {
    try {
      const member = await ctx.telegram.getChatMember(ch.channelId, telegramId);
      const ok = isMemberStatus(member.status);
      membership.push({ channelId: ch.channelId, ok });
      if (ok) joinedChannelIds.push(ch.channelId);
    } catch (err) {
      // Bot kanalni ko‘ra olmasa (admin emas), bu kanalni "not ok" deb hisoblaymiz
      logger.warn({ err, channelId: ch.channelId }, 'getChatMember failed');
      membership.push({ channelId: ch.channelId, ok: false });
    }
  }

  const ok = membership.every((m) => m.ok);

  // joinedChannels — foydalanuvchi oxirgi tekshiruvda a’zo bo‘lgan kanallar
  await User.updateOne(
    { telegramId },
    {
      $set: {
        joinedChannels: joinedChannelIds,
        joinedChannelsCheckedAt: new Date()
      }
    }
  );

  return { ok, channels, joinedChannelIds };
}

/**
 * Live statistika:
 * - jami userlar
 * - full subscribed (joinedChannels $all activeChannels)
 * - har kanal bo‘yicha a’zolar
 * - sourceChannelId (deep link) bo‘yicha kelganlar
 */
async function buildLiveStats() {
  const channels = await getActiveChannels();
  const activeIds = channels.map((c) => c.channelId);

  // Count only real bot users (some legacy/invalid docs may exist without telegramId)
  const userFilter = { telegramId: { $exists: true, $ne: null } };

  const totalUsers = (await User.distinct('telegramId', userFilter)).length;

  let fullySubscribed = 0;
  if (activeIds.length === 0) {
    fullySubscribed = totalUsers;
  } else {
    fullySubscribed = await User.countDocuments({ ...userFilter, joinedChannels: { $all: activeIds } });
  }

  const perChannel = [];
  for (const ch of channels) {
    const count = await User.countDocuments({ ...userFilter, joinedChannels: ch.channelId });
    perChannel.push({ channelId: ch.channelId, title: ch.channelTitle || ch.channelId, count });
  }

  const sourceAgg = await User.aggregate([
    { $match: userFilter },
    {
      $group: {
        _id: '$sourceChannelId',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);

  const allChannelsCount = await Channel.countDocuments({});
  const activeChannelsCount = channels.length;

  return {
    totalUsers,
    fullySubscribed,
    perChannel,
    sourceAgg,
    channels,
    allChannelsCount,
    activeChannelsCount
  };
}

module.exports = {
  parseAdminIds,
  isAdminTelegramId,
  getActiveChannels,
  getAllChannels,
  addChannel,
  deleteChannel,
  setChannelActive,
  updateChannel,
  sendSubscriptionPrompt,
  checkAndUpdateUserChannels,
  buildLiveStats
};
