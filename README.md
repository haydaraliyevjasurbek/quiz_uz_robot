# QUIZ UZ (Telegram Bot)

Node.js + Telegraf + MongoDB (Mongoose) asosida modulli quiz bot.

## Ishga tushirish

1) `.env` yarating (namuna uchun `.env.example`):

- `BOT_TOKEN` — BotFather token
- `MONGODB_URI` — MongoDB URI

2) Dependensiyalar:

```bash
npm install
```

3) Ishga tushirish:

```bash
npm start
```

## Production (Webhook)

Millionlab foydalanuvchi uchun polling o‘rniga webhook tavsiya qilinadi. Webhook rejimini yoqish uchun `.env`ga quyidagilarni bering:

- `WEBHOOK_DOMAIN=https://your-domain.com`
- `WEBHOOK_PATH=/telegraf` (ixtiyoriy)
- `PORT=3000` (ixtiyoriy)

`WEBHOOK_DOMAIN` mavjud bo‘lsa bot webhook bilan, bo‘lmasa polling bilan ishga tushadi.

## Health / Metrics (ixtiyoriy)

`HEALTH_PORT` ni yoqsangiz, quyidagi endpointlar ishga tushadi:
- `GET /health`
- `GET /metrics` (oddiy JSON counterlar)

Dev rejim:

```bash
npm run dev
```

## Bot flow (TZ bo‘yicha)

- `/start`:
  - foydalanuvchi `User` collection’ga `upsert` qilinadi
  - majburiy kanallarga a’zolik tekshiriladi
  - asosiy menyu chiqadi va testlar ro‘yxati (🧪 Testlar) ko‘rsatiladi

- Test jarayoni:
  - test boshlashdan oldin majburiy kanallar tekshiriladi
  - savollar bittadan yuboriladi
  - javoblar `InlineKeyboard` callback orqali olinadi
  - foydalanuvchi javob bergach keyingi savol yuboriladi
  - test davomida “orqaga qaytish” yo‘q (eski savol callback’lari qabul qilinmaydi)
  - variantlar deterministic shuffle (user+test+index bo‘yicha)
  - ixtiyoriy timer: `QUESTION_TIME_SEC` (soft-limit)

- Natija:
  - yakunda `Result` yoziladi
  - ball, to‘g‘ri/noto‘g‘ri soni chiqariladi

- `/my_results`:
  - foydalanuvchining so‘nggi natijalari ko‘rsatiladi

## Fayl/papka struktura

- [index.js](index.js) — botni ishga tushirish, listenerlar va global error handling.
- [config/db.js](config/db.js) — MongoDB ulanishi (pool/tuning qo‘llab-quvvatlanadi).
- [models/User.js](models/User.js) — User schema (telegramId unique), quiz holati DB’da saqlanadi.
- [models/Test.js](models/Test.js) — Test schema (questions: question/options/correct).
- [models/Result.js](models/Result.js) — Result schema (score/totalQuestions/completedAt).
- [models/Channel.js](models/Channel.js) — Mandatory channels schema.
- [models/Admin.js](models/Admin.js) — Admin roles (superadmin/moderator).
- [handlers/start.js](handlers/start.js) — `/start` handler.
- [handlers/userTestsUi.js](handlers/userTestsUi.js) — user: 🧪 Testlar ro‘yxati va test tanlash (inline tugmalar).
- [handlers/quiz.js](handlers/quiz.js) — legacy: “Testni boshlash” handler (kerak bo‘lsa qolgan).
- [handlers/adminHandler.js](handlers/adminHandler.js) — admin: kanal CRUD va statistika.
- [handlers/adminRoleHandler.js](handlers/adminRoleHandler.js) — superadmin: admin roles boshqaruvi.
- [handlers/broadcastHandler.js](handlers/broadcastHandler.js) — superadmin: segment broadcast.
- [services/quizEngine.js](services/quizEngine.js) — quiz mantiqi: savol yuborish, javob tekshirish, natijani yakunlash.
- [services/channelService.js](services/channelService.js) — majburiy kanallar: a’zolik tekshirish, CRUD, live stats.
- [middleware/checkSub.js](middleware/checkSub.js) — har update oldidan subscription check (admin bypass).
- [utils/logger.js](utils/logger.js) — `pino` JSON logger.

## Scalability eslatmalar

- Foydalanuvchi test holati `User` hujjatida saqlanadi (in-memory emas) — bir nechta instans (horizontal scale) bilan ishlaydi.
- Majburiy kanallar holati `User.joinedChannels` da saqlanadi (oxirgi tekshiruv bo‘yicha).
- High-load optimizatsiya: `SUB_CHECK_TTL_MS` orqali a’zolik tekshiruv (getChatMember) chaqiruvlari kamaytiriladi.
- Javob qabul qilish atomik: `activeQuestionIndex` kutilgan qiymat bo‘lsa `updateOne` ishlaydi — double-click/race holatlari kamayadi.
- Production’da polling o‘rniga webhook tavsiya qilinadi (load balancer + bir nechta instans bilan).

## Admin buyruqlar

`.env` ichida `ADMIN_IDS` (vergul bilan) beriladi — bu IDlar **superadmin** sifatida DB'ga seed qilinadi.

- `/channels` — kanallar ro‘yxati va yordam
- `/channel_add <channelId> <inviteLink> <title...>`
- `/channel_del <channelId>`
- `/channel_toggle <channelId> on|off`
- `/channel_edit <channelId> <inviteLink> <title...>`
- `/stats` — live statistika
- `/user_channels <telegramId>` — userning oxirgi membership holati

Test CRUD:
- `/tests`
- `/test_add <title...>`
- `/test_del <testId>`
- `/question_add testId|savol|A|B|C|D|correct(A-D)`

Eksport:
- `/export_results <testId>` — natijalarni CSV qilib yuboradi

Superadmin-only:
- `/admins`
- `/admin_add <telegramId> <superadmin|moderator>`
- `/admin_del <telegramId>`
- `/broadcast <segment> <text...>`
  - segment: `all` | `subscribed` | `not_subscribed` | `source:<channelId>`
- Media/forward: postga reply qilib `/broadcast <segment> [caption...]` (message copy qiladi)
- `/broadcast_status <jobId>`
- `/broadcast_resume <jobId>`
- `/broadcast_cancel <jobId>`

Broadcast tuning:
- `.env`: `BROADCAST_BATCH_SIZE`, `BROADCAST_CONCURRENCY`, `BROADCAST_DELAY_MS`, `BROADCAST_MAX_RETRIES`

## Anti-flood

Rate limiting middleware default yoqilgan (per-instance). Sozlash uchun:
- `RATE_LIMIT_PER_SEC`
- `RATE_LIMIT_BURST`

## Test qo‘shish

Hozir `services/quizEngine.js` ichida demo test avtomatik yaratiladi (agar `Test` bo‘sh bo‘lsa). Real loyihada testlarni alohida admin panel yoki seed skript orqali boshqarish ma’qul.

## Test import (Admin)

Admin panel → 🧪 Testlar → 📥 Import orqali testlarni tez qo‘shish mumkin.
- Matn, `.txt` yoki `.docx` yuboriladi
- Format: `TITLE:` + takrorlanuvchi `Q:` / `A)`..`D)` / `ANS:` bloklari
