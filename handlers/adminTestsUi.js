const { Markup } = require('telegraf');
const https = require('https');
const http = require('http');
const mammoth = require('mammoth');

const adminService = require('../services/adminService');
const testService = require('../services/testService');

// In-memory per-admin wizard state
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
  return Markup.inlineKeyboard([Markup.button.callback('❌ Bekor qilish', 'admin_t:cancel')]);
}

function testsMainKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Test qo‘shish', 'admin_t:add'), Markup.button.callback('🗑 Test o‘chirish', 'admin_t:del')],
    [Markup.button.callback('➕ Savol qo‘shish', 'admin_t:q_add')],
    [Markup.button.callback('📥 Import (TITLE/Q/A/ANS)', 'admin_t:import')],
    [Markup.button.callback('ℹ️ Qo‘llanma', 'admin_t:guide')],
    [Markup.button.callback('🔄 Yangilash', 'admin_t:refresh')]
  ]);
}

function buildTestsGuideText() {
  return (
    "🧪 Test yaratish qo‘llanmasi (Admin)\n\n" +
    "1) Test qo‘shish:\n" +
    "- Admin panel → 🧪 Testlar → ➕ Test qo‘shish\n" +
    "- Bot test nomini so‘raydi → yuborasiz → test yaratiladi\n\n" +
    "2) Savol qo‘shish:\n" +
    "- Admin panel → 🧪 Testlar → ➕ Savol qo‘shish\n" +
    "- Testni tanlaysiz\n" +
    "- Bot ketma-ket so‘raydi: Savol → A → B → C → D → To‘g‘ri javob (A/B/C/D)\n\n" +
    "3) Test o‘chirish:\n" +
    "- Admin panel → 🧪 Testlar → 🗑 Test o‘chirish\n" +
    "- Testni tanlaysiz → tasdiqlaysiz\n\n" +

    "4) Import (matn yoki .txt fayl):\n" +
    "- Admin panel → 🧪 Testlar → 📥 Import\n" +
    "- Matnni yuboring yoki .txt/.docx fayl yuboring\n" +
    "- Preview chiqadi → ✅ Import qilish\n\n" +

    "5) Edit (tahrirlash):\n" +
    "- Hozircha test/savolni tahrirlash tugmasi yo‘q.\n" +
    "- Kerak bo‘lsa ayting: savolni edit qilish (matn/variant/to‘g‘ri javob) funksiyasini qo‘shib beraman.\n\n" +
    "Eslatma:\n" +
    "- Noto‘g‘ri format kiritsangiz bot ❌ xato deb qayta so‘raydi."
  );
}

function isValidTitle(title) {
  const t = String(title || '').trim();
  if (!t) return { ok: false, error: 'Test nomi bo‘sh bo‘lmasin.' };
  if (t.length < 3) return { ok: false, error: 'Test nomi juda qisqa (kamida 3 ta belgi).' };
  if (t.length > 80) return { ok: false, error: 'Test nomi juda uzun (maks 80 ta belgi).' };
  return { ok: true, value: t };
}

function isValidQuestionText(q) {
  const t = String(q || '').trim();
  if (!t) return { ok: false, error: 'Savol matni bo‘sh bo‘lmasin.' };
  if (t.length < 5) return { ok: false, error: 'Savol matni juda qisqa (kamida 5 ta belgi).' };
  if (t.length > 300) return { ok: false, error: 'Savol matni juda uzun (maks 300 ta belgi).' };
  return { ok: true, value: t };
}

function isValidOptionText(v) {
  const t = String(v || '').trim();
  if (!t) return { ok: false, error: 'Variant bo‘sh bo‘lmasin.' };
  if (t.length > 120) return { ok: false, error: 'Variant juda uzun (maks 120 ta belgi).' };
  return { ok: true, value: t };
}

function parseCorrectLetter(s) {
  const v = String(s || '').trim().toUpperCase();
  const idx = ['A', 'B', 'C', 'D'].indexOf(v);
  if (idx === -1) return null;
  return idx;
}

async function renderTestsList(ctx) {
  const tests = await testService.listTests(30);
  if (!tests.length) {
    await ctx.reply('🧪 Testlar: (hozircha yo‘q)\n\nQuyidan test qo‘shing:', testsMainKb());
    return;
  }

  const lines = ['🧪 Testlar:'];
  for (const t of tests) {
    const qCount = Number(t.qCount || 0);
    lines.push(`- ${t.title} | id: ${t._id} | savollar: ${qCount}`);
  }

  await ctx.reply(lines.join('\n'), testsMainKb());
}

async function showAdminTests(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const telegramId = getKey(ctx);
  if (telegramId) clearState(telegramId);

  // When admin opens Tests menu, send a short guide automatically.
  await ctx.reply(buildTestsGuideText());
  await renderTestsList(ctx);
}

async function startAddTest(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const telegramId = getKey(ctx);
  if (!telegramId) return;

  setState(telegramId, { mode: 'add_test', step: 'title', data: {} });
  await ctx.reply('➕ Test qo‘shish\n\nTest nomini yuboring:', cancelKb());
}

function buildImportFormatExample() {
  return (
    "📥 Import format (nusxa qilib yuboring):\n\n" +
    "TITLE: QUIZ UZ - Informatika\n\n" +
    "Q: Kompyuterning ‘miya’si qaysi qism?\n" +
    "A) CPU\n" +
    "B) RAM\n" +
    "C) HDD\n" +
    "D) GPU\n" +
    "ANS: A\n\n" +
    "Q: 2+2=?\n" +
    "A) 3\n" +
    "B) 4\n" +
    "C) 5\n" +
    "D) 22\n" +
    "ANS: B\n"
  );
}

function buildImportConfirmKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Import qilish', 'admin_t:import_confirm')],
    [Markup.button.callback('❌ Bekor qilish', 'admin_t:cancel')]
  ]);
}

function getFileName(doc) {
  return String(doc?.file_name || '').trim();
}

function isTxtDocument(doc) {
  const name = getFileName(doc).toLowerCase();
  const mime = String(doc?.mime_type || '').toLowerCase();
  if (name.endsWith('.txt')) return true;
  if (mime === 'text/plain') return true;
  return false;
}

function isDocxDocument(doc) {
  const name = getFileName(doc).toLowerCase();
  const mime = String(doc?.mime_type || '').toLowerCase();
  if (name.endsWith('.docx')) return true;
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true;
  return false;
}

function supportedImportDocumentTypesHint() {
  return '.txt yoki .docx';
}

function downloadBufferFromUrl(url, maxBytes) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? http : https;

      const req = lib.get(u, (res) => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          reject(new Error(`File download failed (HTTP ${status})`));
          res.resume();
          return;
        }

        let total = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error('File too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });

      req.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

function bufferToUtf8Text(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
}

async function handleImportContent(ctx, telegramId, state, content) {
  const parsed = testService.parseDeterministicImport(content);
  if (parsed.errors && parsed.errors.length) {
    const top = parsed.errors.slice(0, 10).join('\n');
    await ctx.reply(
      `❌ Formatda xatolik bor:\n${top}\n\nQayta yuboring yoki formatni tekshiring.`,
      cancelKb()
    );
    return;
  }

  if (!parsed.questions || parsed.questions.length === 0) {
    await ctx.reply('❌ Savollar topilmadi. Qayta yuboring.', cancelKb());
    return;
  }

  state.data.questions = parsed.questions;
  if (!parsed.title) {
    state.step = 'title';
    setState(telegramId, state);
    await ctx.reply('TITLE topilmadi. Test nomini yuboring:', cancelKb());
    return;
  }

  state.data.title = parsed.title;
  state.step = 'confirm';
  setState(telegramId, state);

  const sample = parsed.questions[0];
  const preview =
    `✅ Import preview:\n` +
    `- Title: ${state.data.title}\n` +
    `- Savollar: ${parsed.questions.length}\n\n` +
    `1) ${sample.question}\n` +
    `A) ${sample.options[0]}\n` +
    `B) ${sample.options[1]}\n` +
    `C) ${sample.options[2]}\n` +
    `D) ${sample.options[3]}\n` +
    `To‘g‘ri: ${['A', 'B', 'C', 'D'][sample.correct]}`;

  await ctx.reply(preview, buildImportConfirmKb());
}

async function startImport(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const telegramId = getKey(ctx);
  if (!telegramId) return;

  setState(telegramId, { mode: 'import', step: 'content', data: {} });
  await ctx.reply(
    `📥 Test import\n\nMatnni yuboring yoki fayl yuboring (${supportedImportDocumentTypesHint()}) (TITLE/Q/A/B/C/D/ANS).\n\n` +
      buildImportFormatExample(),
    cancelKb()
  );
}

async function onDocumentDuringWizard(ctx) {
  const telegramId = getKey(ctx);
  if (!telegramId) return false;

  const state = getState(telegramId);
  if (!state || state.mode !== 'import' || state.step !== 'content') return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  if (!isTxtDocument(doc) && !isDocxDocument(doc)) {
    await ctx.reply(`❌ Hozircha faqat ${supportedImportDocumentTypesHint()} fayl qabul qilinadi.`, cancelKb());
    return true;
  }

  const maxBytes = Number(process.env.IMPORT_TXT_MAX_BYTES || 200_000);
  const fileSize = Number(doc.file_size || 0);
  if (Number.isFinite(fileSize) && fileSize > maxBytes) {
    await ctx.reply(`❌ Fayl juda katta. Maks: ${maxBytes} bayt (~${Math.round(maxBytes / 1024)} KB).`, cancelKb());
    return true;
  }

  try {
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const url = link?.href ? link.href : String(link);

    const buffer = await downloadBufferFromUrl(url, maxBytes);

    if (isDocxDocument(doc)) {
      const result = await mammoth.extractRawText({ buffer });
      const text = String(result?.value || '').trim();
      if (!text) {
        await ctx.reply('❌ Word (.docx) fayldan matn olinmadi. Iltimos tekshirib qayta yuboring.', cancelKb());
        return true;
      }
      await handleImportContent(ctx, telegramId, state, text);
      return true;
    }

    const content = bufferToUtf8Text(buffer);
    await handleImportContent(ctx, telegramId, state, content);
  } catch (e) {
    await ctx.reply(`❌ Faylni o‘qib bo‘lmadi: ${e.message || 'xatolik'}`, cancelKb());
  }

  return true;
}

async function startDeletePick(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const tests = await testService.listTests(30);
  if (!tests.length) {
    await ctx.reply('O‘chirish uchun test yo‘q.', testsMainKb());
    return;
  }

  const buttons = tests.map((t) => [Markup.button.callback(`🗑 ${t.title}`, `admin_t:del_pick:${t._id}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'admin_t:back')]);

  await ctx.reply('🗑 Qaysi testni o‘chiramiz?', Markup.inlineKeyboard(buttons));
}

async function startQuestionPickTest(ctx) {
  if (!(await requireAdmin(ctx))) return;

  const tests = await testService.listTests(30);
  if (!tests.length) {
    await ctx.reply('Savol qo‘shish uchun test yo‘q.', testsMainKb());
    return;
  }

  const buttons = tests.map((t) => [Markup.button.callback(`➕ Savol: ${t.title}`, `admin_t:q_pick:${t._id}`)]);
  buttons.push([Markup.button.callback('⬅️ Orqaga', 'admin_t:back')]);

  await ctx.reply('➕ Qaysi testga savol qo‘shamiz?', Markup.inlineKeyboard(buttons));
}

async function onTextDuringWizard(ctx) {
  const telegramId = getKey(ctx);
  if (!telegramId) return false;

  const state = getState(telegramId);
  if (!state) return false;

  const text = (ctx.message?.text || '').trim();
  if (!text) return true;

  // Let slash-commands pass through (optional cancel)
  if (text.startsWith('/')) {
    if (text === '/cancel') {
      clearState(telegramId);
      await ctx.reply('Bekor qilindi. Admin panel → Testlar orqali davom eting.');
      return true;
    }
    return false;
  }

  if (state.mode === 'add_test' && state.step === 'title') {
    const vt = isValidTitle(text);
    if (!vt.ok) {
      await ctx.reply(`❌ ${vt.error}\nQayta yuboring:`, cancelKb());
      return true;
    }

    try {
      const t = await testService.addTest(vt.value);
      clearState(telegramId);
      await ctx.reply(`✅ Test qo‘shildi: ${t.title}`);
      await renderTestsList(ctx);
    } catch (e) {
      await ctx.reply(`Xatolik: ${e.message || 'Test qo‘shib bo‘lmadi.'}`);
    }
    return true;
  }

  if (state.mode === 'add_question') {
    if (state.step === 'question') {
      const vq = isValidQuestionText(text);
      if (!vq.ok) {
        await ctx.reply(`❌ ${vq.error}\nQayta yuboring:`, cancelKb());
        return true;
      }
      state.data.question = vq.value;
      state.step = 'A';
      setState(telegramId, state);
      await ctx.reply('A varianti matnini yuboring:', cancelKb());
      return true;
    }

    if (['A', 'B', 'C', 'D'].includes(state.step)) {
      const vo = isValidOptionText(text);
      if (!vo.ok) {
        await ctx.reply(`❌ ${vo.error}\nQayta yuboring:`, cancelKb());
        return true;
      }

      state.data.options = state.data.options || {};
      state.data.options[state.step] = vo.value;

      if (state.step === 'A') state.step = 'B';
      else if (state.step === 'B') state.step = 'C';
      else if (state.step === 'C') state.step = 'D';
      else state.step = 'correct';

      setState(telegramId, state);

      if (state.step === 'B') await ctx.reply('B varianti matnini yuboring:', cancelKb());
      else if (state.step === 'C') await ctx.reply('C varianti matnini yuboring:', cancelKb());
      else if (state.step === 'D') await ctx.reply('D varianti matnini yuboring:', cancelKb());
      else await ctx.reply('To‘g‘ri javob harfini yuboring (A/B/C/D):', cancelKb());

      return true;
    }

    if (state.step === 'correct') {
      const correct = parseCorrectLetter(text);
      if (correct === null) {
        await ctx.reply('❌ To‘g‘ri javob faqat A/B/C/D bo‘lishi kerak. Qayta yuboring:', cancelKb());
        return true;
      }

      const options = ['A', 'B', 'C', 'D'].map((k) => state.data.options?.[k] || '');
      if (options.some((o) => !o)) {
        await ctx.reply('❌ Variantlar to‘liq emas. Bekor qilib qayta urinib ko‘ring.', cancelKb());
        return true;
      }

      try {
        const ok = await testService.addQuestion({
          testId: state.data.testId,
          question: state.data.question,
          options,
          correct
        });
        clearState(telegramId);
        await ctx.reply(ok ? '✅ Savol qo‘shildi.' : 'Test topilmadi.');
        await renderTestsList(ctx);
      } catch (e) {
        await ctx.reply(`Xatolik: ${e.message || 'Savol qo‘shib bo‘lmadi.'}`);
      }

      return true;
    }
  }

  if (state.mode === 'import') {
    if (state.step === 'content') {
      await handleImportContent(ctx, telegramId, state, text);
      return true;
    }

    if (state.step === 'title') {
      const vt = isValidTitle(text);
      if (!vt.ok) {
        await ctx.reply(`❌ ${vt.error}\nQayta yuboring:`, cancelKb());
        return true;
      }

      state.data.title = vt.value;
      state.step = 'confirm';
      setState(telegramId, state);

      const sample = state.data.questions[0];
      const preview =
        `✅ Import preview:\n` +
        `- Title: ${state.data.title}\n` +
        `- Savollar: ${state.data.questions.length}\n\n` +
        `1) ${sample.question}\n` +
        `A) ${sample.options[0]}\n` +
        `B) ${sample.options[1]}\n` +
        `C) ${sample.options[2]}\n` +
        `D) ${sample.options[3]}\n` +
        `To‘g‘ri: ${['A', 'B', 'C', 'D'][sample.correct]}`;

      await ctx.reply(preview, buildImportConfirmKb());
      return true;
    }
  }

  return true;
}

function registerAdminTestsUi(bot) {
  // Wizard capture
  bot.on('text', async (ctx, next) => {
    try {
      const handled = await onTextDuringWizard(ctx);
      if (handled) return;
    } catch (_) {
      // ignore
    }
    return next();
  });

  bot.on('document', async (ctx, next) => {
    try {
      const handled = await onDocumentDuringWizard(ctx);
      if (handled) return;
    } catch (_) {
      // ignore
    }
    return next();
  });

  bot.action('admin_t:refresh', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery('Yangilandi');
    await renderTestsList(ctx);
  });

  bot.action('admin_t:guide', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await ctx.reply(buildTestsGuideText(), testsMainKb());
  });

  bot.action('admin_t:back', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await renderTestsList(ctx);
  });

  bot.action('admin_t:cancel', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const telegramId = getKey(ctx);
    if (telegramId) clearState(telegramId);
    await ctx.answerCbQuery('Bekor qilindi');
    await renderTestsList(ctx);
  });

  bot.action('admin_t:add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startAddTest(ctx);
  });

  bot.action('admin_t:import', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startImport(ctx);
  });

  bot.action('admin_t:import_confirm', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const telegramId = getKey(ctx);
    if (!telegramId) return;

    const state = getState(telegramId);
    if (!state || state.mode !== 'import' || state.step !== 'confirm') {
      await ctx.answerCbQuery('Holat topilmadi');
      return;
    }

    await ctx.answerCbQuery('Import qilinyapti...');

    try {
      const created = await testService.createTestWithQuestions({
        title: state.data.title,
        questions: state.data.questions
      });
      clearState(telegramId);
      await ctx.reply(`✅ Import tugadi. Test yaratildi: ${created.title}\nid: ${created._id}`);
      await renderTestsList(ctx);
    } catch (e) {
      await ctx.reply(`Xatolik: ${e.message || 'Import bajarilmadi.'}`);
    }
  });

  bot.action('admin_t:del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startDeletePick(ctx);
  });

  bot.action(/admin_t:del_pick:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const testId = String(ctx.match[1] || '').trim();

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Ha, o‘chirish', `admin_t:del_confirm:${testId}`)],
      [Markup.button.callback('⬅️ Orqaga', 'admin_t:back')]
    ]);

    await ctx.reply(`🗑 Testni o‘chiramizmi?\n${testId}`, kb);
  });

  bot.action(/admin_t:del_confirm:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const testId = String(ctx.match[1] || '').trim();

    const ok = await testService.deleteTest(testId);
    await ctx.reply(ok ? '✅ Test o‘chirildi.' : 'Test topilmadi.');
    await renderTestsList(ctx);
  });

  bot.action('admin_t:q_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startQuestionPickTest(ctx);
  });

  bot.action(/admin_t:q_pick:(.+)/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const telegramId = getKey(ctx);
    if (!telegramId) return;

    const testId = String(ctx.match[1] || '').trim();
    setState(telegramId, { mode: 'add_question', step: 'question', data: { testId } });
    await ctx.reply('➕ Savol qo‘shish\n\nSavol matnini yuboring:', cancelKb());
  });
}

module.exports = {
  registerAdminTestsUi,
  showAdminTests
};
