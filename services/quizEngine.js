const { Markup } = require('telegraf');

const Test = require('../models/Test');
const Result = require('../models/Result');
const User = require('../models/User');
const logger = require('../utils/logger');
const { seededShuffle } = require('../utils/seededShuffle');

function optionLetter(optionIndex) {
  return ['A', 'B', 'C', 'D'][optionIndex] || '?';
}

function normalizeCorrect(correct) {
  if (typeof correct === 'number') return correct;
  if (typeof correct === 'string') {
    const upper = correct.toUpperCase();
    return ['A', 'B', 'C', 'D'].indexOf(upper);
  }
  return -1;
}

function splitTelegramMessages(text, maxLen = 3900) {
  const s = String(text || '');
  if (s.length <= maxLen) return [s];

  const parts = [];
  let buf = '';
  for (const line of s.split('\n')) {
    // +1 for \n when joining
    if ((buf ? buf.length + 1 : 0) + line.length > maxLen) {
      if (buf) parts.push(buf);
      // If a single line is too long, hard-split it.
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          parts.push(line.slice(i, i + maxLen));
        }
        buf = '';
      } else {
        buf = line;
      }
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

function buildReviewText(test, answers) {
  const byQ = new Map();
  for (const a of Array.isArray(answers) ? answers : []) {
    if (a && Number.isFinite(a.q)) byQ.set(Number(a.q), a);
  }

  const lines = ['\n🧾 To‘g‘ri javoblar va xatolar:'];
  const total = Array.isArray(test?.questions) ? test.questions.length : 0;

  for (let i = 0; i < total; i++) {
    const q = test.questions[i];
    const a = byQ.get(i);

    const correctIndex = normalizeCorrect(q.correct);
    const chosenIndex = a && Number.isFinite(a.chosen) ? Number(a.chosen) : -1;
    const isLate = Boolean(a && a.late);
    const isCorrect = !isLate && chosenIndex === correctIndex;

    const correctText =
      correctIndex >= 0 && correctIndex < 4 ? `${optionLetter(correctIndex)}) ${q.options[correctIndex]}` : '(aniqlanmagan)';
    const chosenText =
      chosenIndex >= 0 && chosenIndex < 4 ? `${optionLetter(chosenIndex)}) ${q.options[chosenIndex]}` : '(tanlanmadi)';

    const mark = isCorrect ? '✅' : '❌';
    lines.push(`\n${mark} ${i + 1}) ${q.question}`);
    if (isLate) {
      lines.push(`Siz: ⏱ Vaqt tugadi`);
    } else {
      lines.push(`Siz: ${chosenText}`);
    }
    lines.push(`To‘g‘ri: ${correctText}`);
  }

  return lines.join('\n');
}

async function ensureDefaultTestExists() {
  const count = await Test.estimatedDocumentCount();
  if (count > 0) return;

  await Test.create({
    title: 'QUIZ UZ - Demo test',
    questions: [
      {
        question: 'Node.js nima?',
        options: ['JavaScript runtime', 'Database', 'OS', 'Browser'],
        correct: 0
      },
      {
        question: 'MongoDB qanday turdagi DB?',
        options: ['Relational', 'NoSQL', 'Graph', 'Time-series'],
        correct: 'B'
      }
    ]
  });

  logger.info('Default test created (demo)');
}

async function pickTestForUser() {
  // High-load: random sample o‘rniga eng birinchi testni olamiz (oddiy va tez).
  return Test.findOne({}, { title: 1, questions: 1 }).lean();
}

async function pickTestById(testId) {
  if (!testId) return null;
  return Test.findById(testId, { title: 1, questions: 1 }).lean();
}

async function startTest(ctx, user) {
  await ensureDefaultTestExists();

  const test = await pickTestForUser();
  if (!test || !Array.isArray(test.questions) || test.questions.length === 0) {
    await ctx.reply('Hozircha testlar mavjud emas. Keyinroq urinib ko‘ring.');
    return;
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        step: 'in_quiz',
        activeTestId: test._id,
        activeQuestionIndex: 0,
        activeQuestionSentAt: new Date(),
        activeCorrect: 0,
        activeWrong: 0,
        activeAnswers: []
      }
    }
  );

  await ctx.reply(`Test boshlandi: ${test.title}`);
  await sendQuestion(ctx, test, user.telegramId, 0);
}

async function startTestById(ctx, user, testId) {
  await ensureDefaultTestExists();

  const test = await pickTestById(testId);
  if (!test || !Array.isArray(test.questions) || test.questions.length === 0) {
    await ctx.reply('Test topilmadi yoki bo‘sh. Boshqa testni tanlang.');
    return;
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        step: 'in_quiz',
        activeTestId: test._id,
        activeQuestionIndex: 0,
        activeQuestionSentAt: new Date(),
        activeCorrect: 0,
        activeWrong: 0,
        activeAnswers: []
      }
    }
  );

  await ctx.reply(`Test boshlandi: ${test.title}`);
  await sendQuestion(ctx, test, user.telegramId, 0);
}

function getQuestionTimeSec() {
  const n = Number(process.env.QUESTION_TIME_SEC || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

async function sendQuestion(ctx, test, telegramId, questionIndex) {
  const q = test.questions[questionIndex];
  if (!q) return;

  // Deterministic shuffle: callback ichida original index yuboramiz.
  const seed = `${telegramId}:${test._id}:${questionIndex}`;
  const order = seededShuffle([0, 1, 2, 3], seed);

  const buttons = order.map((origIdx, displayIdx) =>
    Markup.button.callback(
      `${optionLetter(displayIdx)}. ${q.options[origIdx]}`,
      `ans:${test._id}:${questionIndex}:${origIdx}`
    )
  );

  // 2x2 ko‘rinish
  const keyboard = Markup.inlineKeyboard([
    [buttons[0], buttons[1]],
    [buttons[2], buttons[3]]
    ,
    [Markup.button.callback('🛑 To‘xtatish', `stop:${test._id}`)]
  ]);

  const timeSec = getQuestionTimeSec();
  const timeHint = timeSec > 0 ? `\n⏱ ${timeSec}s` : '';
  await ctx.reply(`❓ ${questionIndex + 1}) ${q.question}${timeHint}`, keyboard);
}

async function handleAnswer(ctx) {
  const data = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!data) return;

  // User can cancel the active quiz.
  if (typeof data === 'string' && data.startsWith('stop:')) {
    const testId = data.split(':')[1];
    const telegramId = ctx.from && ctx.from.id;
    if (!telegramId) return;

    const user = await User.findOne(
      { telegramId },
      { step: 1, activeTestId: 1 }
    ).lean();

    if (!user || user.step !== 'in_quiz' || !user.activeTestId) {
      try {
        await ctx.answerCbQuery('Aktiv test yo‘q');
      } catch (_) {
        // ignore
      }
      return;
    }

    if (testId && String(user.activeTestId) !== String(testId)) {
      try {
        await ctx.answerCbQuery('Bu test eskirgan');
      } catch (_) {
        // ignore
      }
      return;
    }

    await User.updateOne(
      { telegramId },
      {
        $set: {
          step: 'idle',
          activeTestId: null,
          activeQuestionIndex: 0,
          activeQuestionSentAt: null,
          activeCorrect: 0,
          activeWrong: 0,
          activeAnswers: []
        }
      }
    );

    try {
      await ctx.answerCbQuery('To‘xtatildi');
    } catch (_) {
      // ignore
    }
    await ctx.reply('🛑 Test to‘xtatildi. Menyudan boshqa testni tanlashingiz mumkin.');
    return;
  }

  if (!data.startsWith('ans:')) return;

  const parts = data.split(':');
  if (parts.length !== 4) return;

  const testId = parts[1];
  const questionIndex = Number(parts[2]);
  const chosenIndex = Number(parts[3]);

  const telegramId = ctx.from && ctx.from.id;
  if (!telegramId) return;

  // Foydalanuvchini minimal maydonlar bilan olamiz.
  const user = await User.findOne(
    { telegramId },
    { step: 1, activeTestId: 1, activeQuestionIndex: 1, activeQuestionSentAt: 1, activeCorrect: 1, activeWrong: 1 }
  ).lean();

  if (!user || user.step !== 'in_quiz' || !user.activeTestId) {
    await ctx.answerCbQuery('Aktiv test topilmadi. /start bosing.');
    return;
  }

  // Orqaga qaytishni bloklash: faqat joriy index qabul qilinadi.
  if (String(user.activeTestId) !== String(testId) || user.activeQuestionIndex !== questionIndex) {
    await ctx.answerCbQuery('Bu savol eskirgan.');
    return;
  }

  const test = await Test.findById(testId, { title: 1, questions: 1 }).lean();
  if (!test || !test.questions || !test.questions[questionIndex]) {
    await ctx.answerCbQuery('Test topilmadi.');
    return;
  }

  const q = test.questions[questionIndex];
  const correctIndex = normalizeCorrect(q.correct);

  const timeSec = getQuestionTimeSec();
  const sentAt = user.activeQuestionSentAt ? new Date(user.activeQuestionSentAt).getTime() : 0;
  const isLate = timeSec > 0 && sentAt > 0 && Date.now() - sentAt > timeSec * 1000;
  const isCorrect = !isLate && chosenIndex === correctIndex;

  // Atomik yangilash: faqat kutilgan activeQuestionIndex bo‘lsa update bo‘ladi.
  const updateRes = await User.updateOne(
    {
      telegramId,
      step: 'in_quiz',
      activeTestId: test._id,
      activeQuestionIndex: questionIndex
    },
    {
      $inc: {
        activeCorrect: isCorrect ? 1 : 0,
        activeWrong: isCorrect ? 0 : 1
      },
      $push: {
        activeAnswers: {
          q: questionIndex,
          chosen: chosenIndex,
          correct: correctIndex,
          late: isLate
        }
      },
      $set: { activeQuestionIndex: questionIndex + 1, activeQuestionSentAt: new Date() }
    }
  );

  if (updateRes.matchedCount !== 1) {
    await ctx.answerCbQuery('Javob qabul qilinmadi. Qayta urinib ko‘ring.');
    return;
  }

  if (isLate) {
    await ctx.answerCbQuery('⏱ Vaqt tugadi');
  } else {
    await ctx.answerCbQuery(isCorrect ? 'To‘g‘ri ✅' : 'Noto‘g‘ri ❌');
  }

  const total = test.questions.length;
  const nextIndex = questionIndex + 1;

  if (nextIndex >= total) {
    // Yakuniy natija uchun yangilangan user holatini qayta olamiz
    const finalUser = await User.findOne(
      { telegramId },
      { activeCorrect: 1, activeWrong: 1, activeTestId: 1, activeAnswers: 1 }
    );

    const correct = finalUser?.activeCorrect || 0;
    const wrong = finalUser?.activeWrong || 0;

    await Result.create({
      userId: finalUser._id,
      testId: test._id,
      score: correct,
      totalQuestions: total,
      completedAt: new Date()
    });

    await User.updateOne(
      { telegramId },
      {
        $set: {
          step: 'idle',
          activeTestId: null,
          activeQuestionIndex: 0,
          activeQuestionSentAt: null,
          activeCorrect: 0,
          activeWrong: 0,
          activeAnswers: []
        }
      }
    );

    const summary =
      `✅ Test yakunlandi!\n\n` +
      `Ball: ${correct}/${total}\n` +
      `To‘g‘ri: ${correct}\n` +
      `Noto‘g‘ri: ${wrong}`;

    const review = buildReviewText(test, finalUser?.activeAnswers);
    const messages = splitTelegramMessages(`${summary}\n${review}`);
    for (const m of messages) {
      if (m && m.trim()) await ctx.reply(m);
    }

    return;
  }

  await sendQuestion(ctx, test, telegramId, nextIndex);
}

module.exports = {
  startTest,
  startTestById,
  ensureDefaultTestExists,
  handleAnswer
};
