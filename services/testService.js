const Test = require('../models/Test');
const Result = require('../models/Result');

function parseCorrectLetter(s) {
  const v = String(s || '').trim().toUpperCase();
  const idx = ['A', 'B', 'C', 'D'].indexOf(v);
  if (idx === -1) return null;
  return idx;
}

function safeTrim(s) {
  return String(s || '').trim();
}

/**
 * Admin format: testId|question|A|B|C|D|correct(A-D)
 */
function parseQuestionAddPayload(raw) {
  const parts = String(raw || '').split('|').map((p) => p.trim());
  if (parts.length < 7) {
    return { error: 'Format: /question_add testId|savol|A|B|C|D|correct(A-D)' };
  }

  const testId = safeTrim(parts[0]);
  const question = safeTrim(parts[1]);
  const options = [safeTrim(parts[2]), safeTrim(parts[3]), safeTrim(parts[4]), safeTrim(parts[5])];
  const correct = parseCorrectLetter(parts[6]);

  if (!testId) return { error: 'testId kerak' };
  if (!question) return { error: 'savol matni kerak' };
  if (options.some((o) => !o)) return { error: 'A/B/C/D variantlari bo‘sh bo‘lmasin' };
  if (correct === null) return { error: 'correct faqat A/B/C/D bo‘lishi kerak' };

  return { testId, question, options, correct };
}

async function listTests(limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return Test.aggregate([
    { $sort: { createdAt: -1 } },
    { $limit: lim },
    { $project: { title: 1, qCount: { $size: '$questions' } } }
  ]);
}

async function getNewestTestId() {
  const t = await Test.findOne({}, { _id: 1 }).sort({ createdAt: -1 }).lean();
  return t ? t._id : null;
}

async function getTopTestIdSince(sinceDate) {
  const since = sinceDate instanceof Date ? sinceDate : new Date(sinceDate);
  if (!Number.isFinite(since.getTime())) return null;

  const rows = await Result.aggregate([
    { $match: { completedAt: { $gte: since } } },
    { $group: { _id: '$testId', attempts: { $sum: 1 } } },
    { $sort: { attempts: -1 } },
    { $limit: 1 }
  ]);

  return rows && rows[0] ? rows[0]._id : null;
}

async function resolveTodayTopTestId() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const top = await getTopTestIdSince(since);
  if (top) return top;
  return getNewestTestId();
}

async function addTest(title) {
  const t = safeTrim(title);
  if (!t) throw new Error('Title bo‘sh bo‘lmasin');
  return Test.create({ title: t, questions: [] });
}

async function createTestWithQuestions({ title, questions }) {
  const t = safeTrim(title);
  if (!t) throw new Error('Title bo‘sh bo‘lmasin');
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('Savollar bo‘sh bo‘lmasin');
  return Test.create({ title: t, questions });
}

function parseDeterministicImport(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  let title = '';
  const questions = [];
  const errors = [];

  let current = null;
  let currentLineNo = 0;

  function pushError(lineNo, msg) {
    errors.push(`Line ${lineNo}: ${msg}`);
  }

  function finalizeCurrent(lineNo) {
    if (!current) return;

    const qNum = questions.length + 1;
    if (!current.question) pushError(lineNo, `${qNum}-savol: Q: topilmadi`);
    const opts = current.options || {};
    for (const k of ['A', 'B', 'C', 'D']) {
      if (!opts[k]) pushError(lineNo, `${qNum}-savol: ${k}) varianti yo‘q`);
    }
    if (current.correct == null) pushError(lineNo, `${qNum}-savol: ANS: topilmadi`);

    if (errors.length) {
      current = null;
      return;
    }

    const options = ['A', 'B', 'C', 'D'].map((k) => opts[k]);
    questions.push({
      question: current.question,
      options,
      correct: current.correct
    });
    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const rawLine = lines[i];
    const line = String(rawLine || '').trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith('TITLE:')) {
      const t = line.slice(6).trim();
      if (!t) pushError(lineNo, 'TITLE: bo‘sh bo‘lmasin');
      else title = t;
      continue;
    }

    if (line.toUpperCase().startsWith('Q:')) {
      // If previous question wasn't finalized (missing ANS), error.
      if (current) {
        pushError(lineNo, 'Oldingi savol yakunlanmagan (ANS: yo‘q).');
        // reset to avoid cascade
        current = null;
      }
      const q = line.slice(2).trim();
      if (!q) pushError(lineNo, 'Q: bo‘sh bo‘lmasin');
      current = { question: q, options: {}, correct: null };
      currentLineNo = lineNo;
      continue;
    }

    const optMatch = line.match(/^([ABCD])\)\s*(.+)$/i);
    if (optMatch) {
      if (!current) {
        pushError(lineNo, 'Variant (A/B/C/D) topildi, lekin undan oldin Q: yo‘q');
        continue;
      }
      const key = optMatch[1].toUpperCase();
      const val = optMatch[2].trim();
      if (!val) {
        pushError(lineNo, `${key}) bo‘sh bo‘lmasin`);
        continue;
      }
      current.options[key] = val;
      continue;
    }

    if (line.toUpperCase().startsWith('ANS:')) {
      if (!current) {
        pushError(lineNo, 'ANS: topildi, lekin undan oldin Q: yo‘q');
        continue;
      }
      const letter = line.slice(4).trim().toUpperCase();
      const correct = parseCorrectLetter(letter);
      if (correct == null) {
        pushError(lineNo, 'ANS: faqat A/B/C/D bo‘lishi kerak');
        // still finalize to avoid stuck
        current.correct = null;
      } else {
        current.correct = correct;
      }
      finalizeCurrent(lineNo);
      continue;
    }

    // Unknown line
    if (current) {
      pushError(lineNo, `Tushunarsiz qator: "${line}". Format: Q:, A) B) C) D), ANS:`);
    } else {
      pushError(lineNo, `Tushunarsiz qator (Q: yo‘q): "${line}"`);
    }
  }

  // If file ends while a question is open
  if (current) {
    pushError(currentLineNo, 'Oxirgi savol yakunlanmagan (ANS: yo‘q).');
  }

  // Global validations
  if (!title) {
    // We allow missing title; caller can ask for it.
  }
  if (questions.length === 0 && errors.length === 0) {
    errors.push('Savollar topilmadi. Formatni tekshiring (Q:/A)/ANS:).');
  }

  return { title, questions, errors };
}

async function deleteTest(testId) {
  const res = await Test.deleteOne({ _id: testId });
  return res.deletedCount === 1;
}

async function addQuestion({ testId, question, options, correct }) {
  const res = await Test.updateOne(
    { _id: testId },
    {
      $push: {
        questions: {
          question,
          options,
          correct
        }
      }
    }
  );

  return res.matchedCount === 1;
}

module.exports = {
  parseQuestionAddPayload,
  parseDeterministicImport,
  listTests,
  getNewestTestId,
  getTopTestIdSince,
  resolveTodayTopTestId,
  addTest,
  createTestWithQuestions,
  deleteTest,
  addQuestion
};
