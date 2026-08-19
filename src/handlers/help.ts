import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const HELP =
  "🎁 Нажмите /start, чтобы открыть меню розыгрышей.\n\n" +
  "Пишите в чате, чтобы участвовать в розыгрыше. Нажмите «Разыграть подарок», когда пора выбрать счастливчика, или отправьте /gift для мгновенного розыгрыша. Администраторы группы меняют подарки и автоподарки в настройках.";

const backToMenu = inlineKeyboard([[inlineButton("← В меню", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
