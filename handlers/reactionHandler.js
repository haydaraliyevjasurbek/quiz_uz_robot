const reactionService = require('../services/reactionService');

function registerReactionHandlers(bot) {
  bot.action(/^react:(up|down)$/, async (ctx) => {
    const vote = ctx.match && ctx.match[1];
    const telegramId = ctx.from?.id;
    const msg = ctx.callbackQuery?.message;
    const chatId = msg?.chat?.id;
    const messageId = msg?.message_id;

    if (!telegramId || !chatId || !messageId) {
      try {
        await ctx.answerCbQuery('Xatolik');
      } catch (_) {
        // ignore
      }
      return;
    }

    const res = await reactionService.applyVote({ chatId, messageId, telegramId, vote });

    try {
      await ctx.editMessageReplyMarkup(reactionService.buildReactionsKb(res.counts).reply_markup);
    } catch (_) {
      // ignore edit errors (e.g., no rights)
    }

    try {
      await ctx.answerCbQuery(res.changed ? '✅' : '✅');
    } catch (_) {
      // ignore
    }
  });
}

module.exports = {
  registerReactionHandlers
};
