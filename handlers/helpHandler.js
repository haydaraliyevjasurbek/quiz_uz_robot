const adminService = require('../services/adminService');

function getUserHelpText() {
  return (
    "QUIZ UZ bot qo‘llanma (foydalanuvchi):\n\n" +
    "Asosiy menyu tugmalari:\n" +
    "1) 🧪 Testlar — testlar ro‘yxati (tanlab boshlaysiz)\n" +
    "2) 📊 Natijalarim — o‘zingizning natijalaringiz\n" +
    "3) ✉️ Admin ga yozish — adminga xabar yuborish\n" +
    "4) 📖 Qo‘llanma — yordam\n\n" +
    "Qanday ishlaydi:\n" +
    "- /start dan keyin bot testlar ro‘yxatini chiqaradi\n" +
    "- Testni tanlasangiz darhol boshlanadi\n\n" +
    "Majburiy kanallar bo‘lsa:\n" +
    "- Bot sizdan kanallarga a’zo bo‘lishni so‘raydi\n" +
    "- A’zo bo‘lgach ‘Tekshirish’ tugmasini bosing"
  );
}

function getAdminHelpText() {
  return (
    "QUIZ UZ bot yordam (ADMIN):\n\n" +
    "Asosiy boshqaruv (tavsiya):\n" +
    "- 🛠 Admin panel → tugmalar orqali hammasi (command shart emas)\n" +
    "  • 📣 Kanallar — qo‘shish/tahrirlash/o‘chirish/yoqish-o‘chirish\n" +
    "  • 🧪 Testlar — test qo‘shish/o‘chirish/savol qo‘shish/import (.txt/.docx)\n" +
    "  • ✉️ Userga yozish — user ID orqali xabar yuborish\n" +
    "  • 👮 Adminlar — admin qo‘shish/o‘chirish/rol berish (faqat superadmin)\n" +
    "  • 📈 Statistika — DB bo‘yicha statistika\n" +
    "  • 📌 Natijalar / 🏆 Attempts TOP — monitoring\n\n" +
    "Diagnostika:\n" +
    "- /my_id — Telegram ID\n" +
    "- /whoami — rolingiz\n\n" +
    "Eslatma:\n" +
    "- Eski commandlar (masalan /channels, /tests ...) qolgan bo‘lishi mumkin, lekin hozir bot tugmalar bilan ishlashga moslangan."
  );
}

async function onHelp(ctx) {
  const telegramId = ctx.from?.id;
  const isAdmin = await adminService.hasAtLeastRole(telegramId, 'moderator');
  await ctx.reply(isAdmin ? getAdminHelpText() : getUserHelpText());
}

async function onMyId(ctx) {
  const id = ctx.from?.id;
  const username = ctx.from?.username ? `@${ctx.from.username}` : '';
  await ctx.reply(`Sizning Telegram ID: ${id} ${username}`.trim());
}

async function onWhoAmI(ctx) {
  const id = ctx.from?.id;
  const role = await adminService.getRole(id);
  const username = ctx.from?.username ? `@${ctx.from.username}` : '';
  await ctx.reply(
    `Siz: ${id} ${username}\nRole: ${role || 'user'}\n` +
      `Adminlarni bot ichidan boshqarish (tavsiya):\n` +
      `- /admins — adminlar ro‘yxati\n` +
      `- /admin_add <telegramId> <moderator|superadmin>\n` +
      `- /admin_del <telegramId>\n\n` +
      `Eslatma: deployda “birinchi superadmin” yo‘qolib ketmasligi uchun ADMIN_IDS ichida o‘zingizning ID’ingizni qoldirib qo‘yish xavfsizroq (fallback).`
  );
}

function registerHelpHandler(bot) {
  bot.command('help', onHelp);
  bot.command('my_id', onMyId);
  bot.command('whoami', onWhoAmI);

  // Keyboard/button support for users who don't know /help
  bot.hears(['📖 Qo‘llanma', "📖 Qo'llanma", 'Qo‘llanma', "Qo'llanma"], onHelp);

  if (typeof bot.help === 'function') {
    bot.help(onHelp);
  }
}

module.exports = { registerHelpHandler, onHelp };
