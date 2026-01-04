const { Markup } = require('telegraf');

function buildMainMenuKeyboard({ isAdmin } = {}) {
  const rows = [['🧪 Testlar', '📊 Natijalarim']];

  // Contact-admin flow is only for regular users.
  if (!isAdmin) {
    rows.push(['✉️ Admin ga yozish', "📖 Qo‘llanma"]);
  } else {
    rows.push(["📖 Qo‘llanma"]);
  }

  if (isAdmin) {
    rows.push(['🛠 Admin panel']);
  }

  return Markup.keyboard(rows).resize();
}

module.exports = {
  buildMainMenuKeyboard
};
