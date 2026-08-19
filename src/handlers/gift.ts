import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { readGiftState, runGiveaway, trackParticipant, writeGiftState } from "../gift-store.js";

registerMainMenuItem({ label: "🎁 Разыграть подарок", data: "gift:run", order: 10 });
registerMainMenuItem({ label: "⚙️ Настройки розыгрыша", data: "gift:settings", order: 20 });

const composer = new Composer<Ctx>();

async function mayManage(ctx: Ctx): Promise<boolean> {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    await acknowledge(ctx, { text: "Откройте настройки в группе, где проходит розыгрыш.", show_alert: true });
    return false;
  }
  if (!ctx.from) return false;
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (member.status === "creator" || member.status === "administrator") return true;
  } catch {
    // Telegram only reveals this when the bot can inspect the group membership.
  }
  await acknowledge(ctx, { text: "Менять настройки может только администратор группы.", show_alert: true });
  return false;
}

// Every settings action is owner-controlled by the Telegram group itself.
composer.callbackQuery(/^gift:(settings|gifts|window|repeat|auto|interval|mention)/, async (ctx, next) => {
  if (!(await mayManage(ctx))) return;
  await next();
});

function homeKeyboard() {
  return inlineKeyboard([[inlineButton("🎁 Разыграть подарок", "gift:run")], [inlineButton("← В меню", "menu:main")]]);
}
function settingsKeyboard() {
  return inlineKeyboard([
    [inlineButton("🎁 Подарок", "gift:gifts"), inlineButton("⏱ Окно активности", "gift:window")],
    [inlineButton("🛡 Защита повторов", "gift:repeat"), inlineButton("🔁 Автоподарки", "gift:auto")],
    [inlineButton("💬 Формат имени", "gift:mention"), inlineButton("← В меню", "menu:main")],
  ]);
}
function winnerName(person: { username?: string; first_name: string }, mention: "username" | "name"): string {
  return mention === "username" && person.username ? `@${person.username}` : person.first_name;
}
function resultText(result: Awaited<ReturnType<typeof runGiveaway>>, mention: "username" | "name"): string {
  if (result.kind === "winner") return `👏 Победитель: ${winnerName(result.participant, mention)} — получает мишка!`;
  if (result.kind === "empty-gifts") return "Подарок ещё не готов — попробуйте чуть позже.";
  if (result.kind === "no-active") return "Пока никто не был активен — дайте чату оживиться и попробуйте ещё раз.";
  return "Все активные участники недавно выигрывали — дайте чату немного времени и попробуйте ещё раз.";
}

/** Callback queries expire quickly; an expired tap must never break the update. */
async function acknowledge(ctx: Ctx, options?: Parameters<Ctx["answerCallbackQuery"]>[0]): Promise<void> {
  try { await ctx.answerCallbackQuery(options); } catch { /* Telegram may reject an old callback. */ }
}

/** A menu message can be too old or already show this view. Send a fresh menu then. */
async function editOrReply(ctx: Ctx, text: string, reply_markup: ReturnType<typeof inlineKeyboard>): Promise<void> {
  try { await ctx.editMessageText(text, { reply_markup }); } catch { await ctx.reply(text, { reply_markup }); }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

async function giveaway(ctx: Ctx, edit: boolean): Promise<void> {
  const state = await readGiftState(ctx);
  const result = await runGiveaway(ctx, "manual");
  const text = resultText(result, state.settings.mentionFormat);
  if (edit) await editOrReply(ctx, text, homeKeyboard());
  else await ctx.reply(text, { reply_markup: homeKeyboard() });
}

// The one power-user shortcut required by the product contract.
composer.command("gift", async (ctx) => {
  await trackParticipant(ctx);
  await giveaway(ctx, false);
});

composer.callbackQuery("gift:run", async (ctx) => {
  await acknowledge(ctx);
  await giveaway(ctx, true);
});

composer.callbackQuery("gift:settings", async (ctx) => {
  await acknowledge(ctx);
  await editOrReply(ctx, "Настройте розыгрыши здесь. Выберите, что изменить.", settingsKeyboard());
});

composer.callbackQuery("gift:gifts", async (ctx) => {
  await acknowledge(ctx);
  await editOrReply(ctx, "В этом розыгрыше всегда разыгрывается мишка.", inlineKeyboard([
    [inlineButton("← Настройки", "gift:settings")],
  ]));
});

composer.callbackQuery("gift:window", async (ctx) => {
  await acknowledge(ctx);
  await editOrReply(ctx, "Как давно участник должен был писать в чат?", inlineKeyboard([
    [inlineButton("15 минут", "gift:window:15"), inlineButton("30 минут", "gift:window:30"), inlineButton("60 минут", "gift:window:60")],
    [inlineButton("← Настройки", "gift:settings")],
  ]));
});

composer.callbackQuery(/^gift:window:(15|30|60)$/, async (ctx) => {
  await acknowledge(ctx);
  const minutes = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.activeWindowMinutes = minutes; await writeGiftState(ctx, state);
  await editOrReply(ctx, `Окно активности: ${formatNumber(minutes)} мин.`, settingsKeyboard());
});

composer.callbackQuery("gift:repeat", async (ctx) => {
  await acknowledge(ctx);
  await editOrReply(ctx, "Сколько последних победителей пропускают розыгрыш?", inlineKeyboard([
    [inlineButton("1 победитель", "gift:repeat:1"), inlineButton("2 победителя", "gift:repeat:2"), inlineButton("3 победителя", "gift:repeat:3")],
    [inlineButton("← Настройки", "gift:settings")],
  ]));
});
composer.callbackQuery(/^gift:repeat:(1|2|3)$/, async (ctx) => {
  await acknowledge(ctx);
  const value = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.repeatProtection = value; await writeGiftState(ctx, state);
  await editOrReply(ctx, `Последние ${formatNumber(value)} победителя пропустят розыгрыш.`, settingsKeyboard());
});

composer.callbackQuery("gift:auto", async (ctx) => {
  await acknowledge(ctx);
  const state = await readGiftState(ctx);
  const status = state.settings.automaticEnabled ? "включены" : "выключены";
  await editOrReply(ctx, `Автоподарки ${status}. Новый подарок выбирается через случайный промежуток от 1 до 90 минут.`, inlineKeyboard([
    [inlineButton("Включить", "gift:auto:on"), inlineButton("Выключить", "gift:auto:off")],
    [inlineButton("Интервал 1–90 минут", "gift:interval:1:90")],
    [inlineButton("← Настройки", "gift:settings")],
  ]));
});
composer.callbackQuery(/^gift:auto:(on|off)$/, async (ctx) => {
  await acknowledge(ctx);
  const on = ctx.match[1] === "on"; const state = await readGiftState(ctx);
  state.settings.automaticEnabled = on;
  state.settings.intervalMinMinutes = 1; state.settings.intervalMaxMinutes = 90;
  await writeGiftState(ctx, state);
  await editOrReply(ctx, on ? "Автоподарки включены — начинаем веселье! Интервал: от 1 до 90 минут." : "Автоподарки на паузе.", settingsKeyboard());
});
composer.callbackQuery("gift:interval:1:90", async (ctx) => {
  await acknowledge(ctx);
  const state = await readGiftState(ctx); state.settings.intervalMinMinutes = 1; state.settings.intervalMaxMinutes = 90; await writeGiftState(ctx, state);
  await editOrReply(ctx, "Автоподарки проходят через случайный промежуток от 1 до 90 минут.", settingsKeyboard());
});

composer.callbackQuery("gift:mention", async (ctx) => {
  await acknowledge(ctx);
  await editOrReply(ctx, "Как показывать имя победителя?", inlineKeyboard([
    [inlineButton("Использовать @username", "gift:mention:username"), inlineButton("Использовать имя", "gift:mention:name")],
    [inlineButton("← Настройки", "gift:settings")],
  ]));
});
composer.callbackQuery(/^gift:mention:(username|name)$/, async (ctx) => {
  await acknowledge(ctx);
  const state = await readGiftState(ctx); state.settings.mentionFormat = ctx.match[1] as "username" | "name"; await writeGiftState(ctx, state);
  await editOrReply(ctx, ctx.match[1] === "username" ? "Будем использовать @username, если он есть." : "Будем использовать имя участника.", settingsKeyboard());
});

export default composer;
