const Result = require('../models/Result');
const User = require('../models/User');

/**
 * /my_results: foydalanuvchining so‘nggi natijalarini ko‘rsatadi.
 */
async function onMyResults(ctx) {
  const telegramId = ctx.from.id;
  const user = await User.findOne({ telegramId }, { _id: 1 }).lean();
  if (!user) {
    await ctx.reply('Iltimos, avval /start bosing.');
    return;
  }

  const limit = Math.min(Number(process.env.MY_RESULTS_LIMIT || 10), 30);

  const results = await Result.find(
    { userId: user._id },
    { score: 1, totalQuestions: 1, completedAt: 1, testId: 1 }
  )
    .sort({ completedAt: -1 })
    .limit(limit)
    .populate('testId', 'title')
    .lean();

  if (!results.length) {
    await ctx.reply('Hozircha natijalar yo‘q. Testni boshlash uchun: "🧪 Testlar"');
    return;
  }

  const lines = ['📌 Mening natijalarim:'];
  for (const r of results) {
    const title = r.testId && r.testId.title ? r.testId.title : 'Test';
    const when = r.completedAt ? new Date(r.completedAt).toLocaleString() : '';
    lines.push(`- ${title}: ${r.score}/${r.totalQuestions} (${when})`);
  }

  await ctx.reply(lines.join('\n'));
}

module.exports = {
  onMyResults
};
