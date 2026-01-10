require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');

const { connectDB } = require('./config/db');
const logger = require('./utils/logger');

const { onStart } = require('./handlers/start');
const { showUserTests, sendUserTestsList, startSelectedTest } = require('./handlers/userTestsUi');
const quizEngine = require('./services/quizEngine');
const checkSub = require('./middleware/checkSub');
const rateLimit = require('./middleware/rateLimit');

const { onMyResults } = require('./handlers/userHandler');
const { onTests, onTestAdd, onTestDel, onQuestionAdd } = require('./handlers/testAdminHandler');
const { onExportResults } = require('./handlers/exportHandler');
const { onResultsAll, onAttemptsTop, onAttemptsUser } = require('./handlers/resultsAdminHandler');

const {
  onChannels,
  onChannelAdd,
  onChannelDel,
  onChannelToggle,
  onChannelEdit,
  onStats,
  onUserChannels
} = require('./handlers/adminHandler');

const channelService = require('./services/channelService');
const adminService = require('./services/adminService');
const { registerAdminRoleHandlers } = require('./handlers/adminRoleHandler');
const { registerBroadcastHandler } = require('./handlers/broadcastHandler');
const { registerHelpHandler } = require('./handlers/helpHandler');
const { registerAdminMenu } = require('./handlers/adminMenuHandler');
const { registerContactAdmin } = require('./handlers/contactAdminHandler');
const { buildMainMenuKeyboard } = require('./utils/keyboards');
const metrics = require('./utils/metrics');
const { startHealthServer } = require('./services/healthServer');
const { registerReactionHandlers } = require('./handlers/reactionHandler');
const { registerLiveStatus } = require('./handlers/liveStatusHandler');

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

async function bootstrap() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('BOT_TOKEN .env da topilmadi');
  }

  await connectDB();
  await adminService.ensureSuperadminsFromEnv();

  // Optional health server
  const healthPort = Number(process.env.HEALTH_PORT || 0);
  if (healthPort) {
    startHealthServer({ port: healthPort });
    logger.info({ healthPort }, 'Health server started');
  }

  const bot = new Telegraf(token, {
    handlerTimeout: Number(process.env.BOT_HANDLER_TIMEOUT_MS || 8000)
  });

  bot.catch((err, ctx) => {
    logger.error({ err, updateId: ctx.update.update_id }, 'Bot error');
  });

  // Middleware: anti-flood
  bot.use(rateLimit());

  // Middleware: majburiy kanal tekshiruvi (admin bypass)
  bot.use(checkSub());

  // /start
  bot.start(onStart);

  // /help (admin uchun to'liq yordam, user uchun oddiy yordam)
  registerHelpHandler(bot);

  // User -> Admin contact (button-driven)
  registerContactAdmin(bot);


  // Faqat muhim joylarda metrics ishlatiladi (masalan, health serverda yoki xatoliklarda)
  bot.on('message', async (ctx, next) => {
    return next();
  });

  // User commands
  bot.command('my_results', onMyResults);

  // Admin commands
  bot.command('channels', onChannels);
  bot.command('channel_add', onChannelAdd);
  bot.command('channel_del', onChannelDel);
  bot.command('channel_toggle', onChannelToggle);
  bot.command('channel_edit', onChannelEdit);
  bot.command('stats', onStats);
  bot.command('user_channels', onUserChannels);

  // Admin test CRUD
  bot.command('tests', onTests);
  bot.command('test_add', onTestAdd);
  bot.command('test_del', onTestDel);
  bot.command('question_add', onQuestionAdd);

  // Admin export
  bot.command('export_results', onExportResults);

  // Admin analytics: results + attempts
  bot.command('results_all', onResultsAll);
  bot.command('attempts_top', onAttemptsTop);
  bot.command('attempts_user', onAttemptsUser);

  // Superadmin-only: roles + broadcast
  registerAdminRoleHandlers(bot);
  registerBroadcastHandler(bot);

  // Admin panel (button-driven)
  registerAdminMenu(bot);

  // Like/Dislike for broadcast posts
  registerReactionHandlers(bot);

  // Env user: live monitoring message (updates every 5s)
  registerLiveStatus(bot);

  // Legacy alias: old "Testni boshlash" tugmasi → endi testlar ro‘yxatini ochadi
  bot.hears(['🧠 Testni boshlash', 'Testni boshlash'], showUserTests);

  // User: tests list
  bot.hears(['🧪 Testlar', 'Testlar'], showUserTests);

  // "Natijalarim" tugmasi
  bot.hears(['📊 Natijalarim', 'Natijalarim'], onMyResults);

  // Callback queries: subscription check yoki quiz answer

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery && ctx.callbackQuery.data;

    try {
      if (data === 'check_sub') {
        const res = await channelService.checkAndUpdateUserChannels(ctx);
        if (res.ok) {
          await ctx.answerCbQuery('✅ A’zo bo‘ldingiz');
          const isAdmin = await adminService.hasAtLeastRole(ctx.from.id, 'moderator');
          await ctx.reply('✅ Rahmat! Endi botdan foydalanishingiz mumkin.', buildMainMenuKeyboard({ isAdmin }));
        } else {
          await ctx.answerCbQuery('Hali ham a’zo emassiz');
          await channelService.sendSubscriptionPrompt(ctx, res.channels);
        }
        return;
      }

      // User selected a test from the list
      if (typeof data === 'string' && data.startsWith('u_test:')) {
        await ctx.answerCbQuery();
        const testId = data.slice('u_test:'.length);
        await startSelectedTest(ctx, testId);
        return;
      }

      if (data === 'noop') {
        await ctx.answerCbQuery('Link orqali a’zo bo‘ling.');
        return;
      }

      // Default: quiz answer
      await quizEngine.handleAnswer(ctx);
    } catch (err) {
      logger.error({ err }, 'callback_query handler failed');
      try {
        await ctx.answerCbQuery('Xatolik yuz berdi. Qayta urinib ko‘ring.');
      } catch (_) {
        // ignore
      }
    }
  });

  // High-load uchun webhook tavsiya qilinadi.
  // WEBHOOK_DOMAIN berilsa webhook, aks holda polling.
  const webhookDomain = process.env.WEBHOOK_DOMAIN;
  const webhookPath = process.env.WEBHOOK_PATH || '/telegraf';
  const port = Number(process.env.PORT || 3000);
  const dropPendingUpdates = envBool('DROP_PENDING_UPDATES', true);

  if (webhookDomain) {
    await bot.launch({
      webhook: {
        domain: webhookDomain,
        hookPath: webhookPath,
        port
      },
      allowedUpdates: ['message', 'callback_query'],
      dropPendingUpdates
    });
    logger.info({ webhookDomain, webhookPath, port }, 'Bot started (webhook)');
  } else {
    await bot.launch({
      allowedUpdates: ['message', 'callback_query'],
      dropPendingUpdates
    });
    logger.info('Bot started (polling)');
  }


  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...');
    try {
      await bot.stop(signal);
    } catch (_) {
      // ignore
    }
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException');
  process.exit(1);
});


module.exports = {
  bootstrap
};

// Faqat `node index.js` bilan ishga tushirilsa start qilamiz.
if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error({ err }, 'Bootstrap failed');
    process.exit(1);
  });
}

// Polling rejimida HTTP port ochish (Render uchun)
if (!process.env.WEBHOOK_DOMAIN) {
  const express = require('express');
  const app = express();
  const port = Number(process.env.PORT || 3000);
  app.get('/', (req, res) => res.send('Bot ishlayapti!'));
  app.listen(port, () => {
    logger.info(`Express server ${port}-portda ishga tushdi`);
  });
}
