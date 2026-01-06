const os = require('os');

const mongoose = require('mongoose');

const User = require('../models/User');

function parseIdList(envValue) {
  const raw = String(envValue || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function isLiveStatusViewer(telegramId) {
  const id = Number(telegramId);
  if (!Number.isFinite(id)) return false;

  // If LIVE_STATUS_IDS is not set, fallback to ADMIN_IDS (superadmins) for convenience.
  const viewers = parseIdList(process.env.LIVE_STATUS_IDS);
  if (viewers.length) return viewers.includes(id);

  const fallbackAdmins = parseIdList(process.env.ADMIN_IDS);
  return fallbackAdmins.includes(id);
}

function buildKeyboard({ running }) {
  const rows = [];
  if (!running) rows.push([{ text: '▶️ Live yoqish', callback_data: 'live_status:start' }]);
  if (running) rows.push([{ text: '⏹ To‘xtatish', callback_data: 'live_status:stop' }]);
  return { inline_keyboard: rows };
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? String(Math.round(x)) : x.toFixed(1);
  return `${fixed} ${units[i]}`;
}

async function getStatsSnapshot() {
  const userFilter = { telegramId: { $exists: true, $ne: null } };

  const [totalUsers, blockedUsers, inQuizUsers] = await Promise.all([
    User.countDocuments(userFilter),
    User.countDocuments({ ...userFilter, isBlocked: true }),
    User.countDocuments({ ...userFilter, step: 'in_quiz' })
  ]);

  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.floor(process.uptime()),
    dbReadyState: mongoose.connection.readyState,
    users: { total: totalUsers, blocked: blockedUsers, inQuiz: inQuizUsers },
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    }
  };
}

function computeCpuPercent(prevCpu, prevAtMs, nowCpu, nowAtMs) {
  const dtMs = Math.max(1, Number(nowAtMs) - Number(prevAtMs));
  const diffUser = Math.max(0, (nowCpu.user || 0) - (prevCpu.user || 0));
  const diffSys = Math.max(0, (nowCpu.system || 0) - (prevCpu.system || 0));
  const diffMicros = diffUser + diffSys;

  const cores = Math.max(1, (os.cpus() || []).length || 1);
  const cpu = (diffMicros / (dtMs * 1000 * cores)) * 100;
  return Math.max(0, Math.min(100, cpu));
}

function buildText(snapshot, cpuPercent) {
  const dbState = snapshot.dbReadyState;
  const dbText = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : dbState === 0 ? 'disconnected' : String(dbState);

  return (
    '📡 Live status (har 5s yangilanadi)\n\n' +
    `⏱ Uptime: ${snapshot.uptimeSec}s\n` +
    `🗄 DB: ${dbText}\n` +
    `👥 Userlar: ${snapshot.users.total}\n` +
    `⛔ Blocked: ${snapshot.users.blocked}\n` +
    `🧠 In quiz: ${snapshot.users.inQuiz}\n\n` +
    `🧮 CPU(approx): ${cpuPercent.toFixed(1)}%\n` +
    `💾 RAM RSS: ${formatBytes(snapshot.memory.rss)}\n` +
    `📦 Heap: ${formatBytes(snapshot.memory.heapUsed)} / ${formatBytes(snapshot.memory.heapTotal)}`
  );
}

// In-memory running sessions: telegramId -> { chatId, messageId, timer, prevCpu, prevAtMs }
const sessions = new Map();

async function startLive(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isLiveStatusViewer(telegramId)) {
    await ctx.answerCbQuery?.('Ruxsat yo‘q');
    return;
  }

  const existing = sessions.get(telegramId);
  if (existing) {
    await ctx.answerCbQuery?.('Allaqachon yoqilgan');
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCbQuery?.('Chat topilmadi');
    return;
  }

  await ctx.answerCbQuery?.();

  const prevCpu = process.cpuUsage();
  const prevAtMs = Date.now();

  const snapshot = await getStatsSnapshot();
  const text = buildText(snapshot, 0);

  const msg = await ctx.reply(text, { reply_markup: buildKeyboard({ running: true }) });

  const messageId = msg?.message_id;
  if (!messageId) return;

  const timer = setInterval(async () => {
    const s = sessions.get(telegramId);
    if (!s) return;

    const nowCpu = process.cpuUsage();
    const nowAtMs = Date.now();

    let snapshotNow;
    try {
      snapshotNow = await getStatsSnapshot();
    } catch (err) {
      try {
        await ctx.telegram.editMessageText(chatId, messageId, undefined, `❌ Stats olishda xatolik: ${err?.message || String(err)}`, {
          reply_markup: buildKeyboard({ running: true })
        });
      } catch (_) {
        // ignore
      }
      return;
    }

    const cpuPercent = computeCpuPercent(s.prevCpu, s.prevAtMs, nowCpu, nowAtMs);
    s.prevCpu = nowCpu;
    s.prevAtMs = nowAtMs;

    const nextText = buildText(snapshotNow, cpuPercent);
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, nextText, {
        reply_markup: buildKeyboard({ running: true })
      });
    } catch (err) {
      // If we cannot edit (message deleted / old / permissions), stop updating.
      clearInterval(s.timer);
      sessions.delete(telegramId);
    }
  }, 5000);

  sessions.set(telegramId, { chatId, messageId, timer, prevCpu, prevAtMs });
}

async function stopLive(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isLiveStatusViewer(telegramId)) {
    await ctx.answerCbQuery?.('Ruxsat yo‘q');
    return;
  }

  const s = sessions.get(telegramId);
  await ctx.answerCbQuery?.();

  if (!s) {
    await ctx.reply('Live status yoqilmagan. /live_status');
    return;
  }

  clearInterval(s.timer);
  sessions.delete(telegramId);

  try {
    await ctx.telegram.editMessageText(s.chatId, s.messageId, undefined, '⏹ Live status to‘xtatildi.', {
      reply_markup: buildKeyboard({ running: false })
    });
  } catch (_) {
    // ignore
  }
}

async function onLiveStatusCommand(ctx) {
  const telegramId = ctx.from?.id;
  if (!telegramId || !isLiveStatusViewer(telegramId)) {
    await ctx.reply('Ruxsat yo‘q.');
    return;
  }

  const running = sessions.has(telegramId);
  await ctx.reply('📡 Live status boshqaruvi:', { reply_markup: buildKeyboard({ running }) });
}

function registerLiveStatus(bot) {
  bot.command('live_status', onLiveStatusCommand);
  bot.action('live_status:start', startLive);
  bot.action('live_status:stop', stopLive);
}

module.exports = {
  registerLiveStatus
};
