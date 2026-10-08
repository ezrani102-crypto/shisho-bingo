const dictionary = {
  en: {
    welcome: "Welcome to SHISHO BINGO! 🎱\nPlease select your language:",
    main_menu: "🏠 Main Menu\nSelect an option below:",
    lang_updated: "✅ Language updated to English.",
    btn_play: "🎮 Play",
    btn_balance: "💰 Balance",
    btn_deposit: "➕ Deposit",
    btn_withdraw: "💸 Withdraw",
    btn_invite: "🎁 Invite",
    btn_profile: "👤 Profile",
    btn_history: "📜 History",
    btn_support: "🆘 Support",
    btn_language: "🌐 Language"
  },
  am: {
    welcome: "እንኳን ወደ SHISHO BINGO በደህና መጡ! 🎱\nእባክዎ ቋንቋ ይምረጡ:",
    main_menu: "🏠 ዋና ማውጫ\nከታች ያለውን አማራጭ ይምረጡ:",
    lang_updated: "✅ ቋንቋ ወደ አማርኛ ተቀይሯል።",
    btn_play: "🎮 አጫውት (Play)",
    btn_balance: "💰 ቀሪ ሂሳብ",
    btn_deposit: "➕ ገቢ አድርግ",
    btn_withdraw: "💸 ወጪ አድርግ",
    btn_invite: "🎁 ጋብዝ",
    btn_profile: "👤 ፕሮፋይል",
    btn_history: "📜 ታሪክ",
    btn_support: "🆘 ድጋፍ",
    btn_language: "🌐 ቋንቋ"
  }
};

const t = (lang, key) => dictionary[lang]?.[key] || dictionary['en'][key];

module.exports = { t };