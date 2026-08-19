import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { readGiftState, runGiveaway, trackParticipant, writeGiftState, type Gift } from "../gift-store.js";
import { now } from "../clock.js";

registerMainMenuItem({ label: "🎁 Разыграть подарок", data: "gift:run", order: 10 });
registerMainMenuItem({ label: "⚙️ Настройки розыгрыша", data: "gift:settings", order: 20 });

const composer = new Composer<Ctx>();

async function mayManage(ctx: Ctx): Promise<boolean> {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    await ctx.answerCallbackQuery({ text: "Откройте настройки в группе, где проходит розыгрыш.", show_alert: true });
    return false;
  }
  if (!ctx.from) return false;
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (member.status === "creator" || member.status === "administrator") return true;
  } catch {
    // Telegram only reveals this when the bot can inspect the group membership.
  }
  await ctx.answerCallbackQuery({ text: "Менять настройки может только администратор группы.", show_alert: true });
  return false;
}

// Every settings action is owner-controlled by the Telegram group itself.
composer.callbackQuery(/^gift:(settings|gifts|add|remove|window|repeat|auto|interval|mention)/, async (ctx, next) => {
  if (!(await mayManage(ctx))) return;
  await next();
});

function homeKeyboard() {
  return inlineKeyboard([[inlineButton("🎁 Разыграть подарок", "gift:run")], [inlineButton("← В меню", "menu:main")]]);
}
function settingsKeyboard() {
  return inlineKeyboard([
    [inlineButton("🎁 Изменить подарки", "gift:gifts"), inlineButton("⏱ Окно активности", "gift:window")],
    [inlineButton("🛡 Защита повторов", "gift:repeat"), inlineButton("🔁 Автоподарки", "gift:auto")],
    [inlineButton("💬 Формат имени", "gift:mention"), inlineButton("← В меню", "menu:main")],
  ]);
}
function winnerName(person: { username?: string; first_name: string }, mention: "username" | "name"): string {
  return mention === "username" && person.username ? `@${person.username}` : person.first_name;
}
function resultText(result: Awaited<ReturnType<typeof runGiveaway>>, mention: "username" | "name"): string {
  if (result.kind === "winner") return `🎁 ${winnerName(result.participant, mention)} получает ${result.gift.emoji} «${result.gift.gift_name}»! Вот это удача!`;
  if (result.kind === "empty-gifts") return "Корзинка подарков пуста — администратор может добавить подарок в настройках.";
  if (result.kind === "no-active") return "Пока никто не был активен — дайте чату оживиться и попробуйте ещё раз.";
  return "Все активные участники недавно выигрывали — дайте чату немного времени и попробуйте ещё раз.";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function hasRussianName(value: string): boolean {
  return /[А-Яа-яЁё]/u.test(value);
}

async function giveaway(ctx: Ctx, edit: boolean): Promise<void> {
  const state = await readGiftState(ctx);
  const result = await runGiveaway(ctx, "manual");
  const text = resultText(result, state.settings.mentionFormat);
  if (edit) await ctx.editMessageText(text, { reply_markup: homeKeyboard() });
  else await ctx.reply(text, { reply_markup: homeKeyboard() });
}

// The one power-user shortcut required by the product contract.
composer.command("gift", async (ctx) => {
  await trackParticipant(ctx);
  await giveaway(ctx, false);
});

composer.callbackQuery("gift:run", async (ctx) => {
  await ctx.answerCallbackQuery();
  await giveaway(ctx, true);
});

composer.callbackQuery("gift:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Настройте розыгрыши здесь. Выберите, что изменить.", { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:gifts", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx);
  const list = state.gifts.map((gift) => `${gift.emoji} ${gift.gift_name}`).join("\n") || "Подарков пока нет — добавьте первый.";
  await ctx.editMessageText(`Ваша корзинка подарков:\n${list}`, { reply_markup: inlineKeyboard([
    [inlineButton("➕ Добавить подарок", "gift:add"), inlineButton("➖ Убрать подарок", "gift:remove")],
    [inlineButton("← Настройки", "gift:settings")],
  ]) });
});

composer.callbackQuery("gift:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.giftFlow = "add-gift";
  ctx.session.giftFlowStartedAt = now();
  await ctx.reply("Отправьте эмодзи и русское название подарка, например 🎈 Воздушный шар.", { reply_markup: { force_reply: true, input_field_placeholder: "🎈 Воздушный шар" } });
});

composer.callbackQuery("gift:remove", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.giftFlow = "remove-gift";
  ctx.session.giftFlowStartedAt = now();
  await ctx.reply("Отправьте точное название подарка, который хотите убрать.", { reply_markup: { force_reply: true, input_field_placeholder: "Название подарка" } });
});

composer.callbackQuery("gift:window", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Как давно участник должен был писать в чат?", { reply_markup: inlineKeyboard([
    [inlineButton("15 минут", "gift:window:15"), inlineButton("30 минут", "gift:window:30"), inlineButton("60 минут", "gift:window:60")],
    [inlineButton("← Настройки", "gift:settings")],
  ]) });
});

composer.callbackQuery(/^gift:window:(15|30|60)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const minutes = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.activeWindowMinutes = minutes; await writeGiftState(ctx, state);
  await ctx.editMessageText(`Окно активности: ${formatNumber(minutes)} мин.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:repeat", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Сколько последних победителей пропускают розыгрыш?", { reply_markup: inlineKeyboard([
    [inlineButton("1 победитель", "gift:repeat:1"), inlineButton("2 победителя", "gift:repeat:2"), inlineButton("3 победителя", "gift:repeat:3")],
    [inlineButton("← Настройки", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:repeat:(1|2|3)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const value = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.repeatProtection = value; await writeGiftState(ctx, state);
  await ctx.editMessageText(`Последние ${formatNumber(value)} победителя пропустят розыгрыш.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:auto", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx);
  const status = state.settings.automaticEnabled ? "включены" : "выключены";
  await ctx.editMessageText(`Автоподарки ${status}.`, { reply_markup: inlineKeyboard([
    [inlineButton("Включить", "gift:auto:on"), inlineButton("Выключить", "gift:auto:off")],
    [inlineButton("5–30 минут", "gift:interval:5:30"), inlineButton("30–90 минут", "gift:interval:30:90")],
    [inlineButton("← Настройки", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:auto:(on|off)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const on = ctx.match[1] === "on"; const state = await readGiftState(ctx);
  state.settings.automaticEnabled = on; await writeGiftState(ctx, state);
  await ctx.editMessageText(on ? "Автоподарки включены — начинаем веселье!" : "Автоподарки на паузе.", { reply_markup: settingsKeyboard() });
});
composer.callbackQuery(/^gift:interval:(5|30):(30|90)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx); state.settings.intervalMinMinutes = Number(ctx.match[1]); state.settings.intervalMaxMinutes = Number(ctx.match[2]); await writeGiftState(ctx, state);
  await ctx.editMessageText(`Автоподарки будут проходить каждые ${formatNumber(Number(ctx.match[1]))}–${formatNumber(Number(ctx.match[2]))} мин.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:mention", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Как показывать имя победителя?", { reply_markup: inlineKeyboard([
    [inlineButton("Использовать @username", "gift:mention:username"), inlineButton("Использовать имя", "gift:mention:name")],
    [inlineButton("← Настройки", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:mention:(username|name)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx); state.settings.mentionFormat = ctx.match[1] as "username" | "name"; await writeGiftState(ctx, state);
  await ctx.editMessageText(ctx.match[1] === "username" ? "Будем использовать @username, если он есть." : "Будем использовать имя участника.", { reply_markup: settingsKeyboard() });
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.giftFlow;
  if (!flow || ctx.message.text.startsWith("/")) return next();
  if ((ctx.session.giftFlowStartedAt ?? 0) + 5 * 60_000 < now()) {
    ctx.session.giftFlow = undefined;
    ctx.session.giftFlowStartedAt = undefined;
    await ctx.reply("Время на изменение подарка вышло — нажмите «Изменить подарки» и начните снова.");
    return;
  }
  const input = ctx.message.text.trim(); const state = await readGiftState(ctx);
  ctx.session.giftFlow = undefined;
  ctx.session.giftFlowStartedAt = undefined;
  if (flow === "add-gift") {
    const match = input.match(/^(\S+)\s+(.+)$/);
    if (!match || !hasRussianName(match[2])) { await ctx.reply("Нужны эмодзи и русское название, например 🎈 Воздушный шар. Попробуйте снова через «Изменить подарки»."); return; }
    state.gifts.push({ emoji: match[1], gift_name: match[2].slice(0, 60) }); await writeGiftState(ctx, state);
    await ctx.reply(`${match[1]} ${match[2].slice(0, 60)} уже в корзинке!`); return;
  }
  const index = state.gifts.findIndex((gift: Gift) => gift.gift_name.toLowerCase() === input.toLowerCase());
  if (index < 0) { await ctx.reply("Не нашёл такой подарок. Проверьте название и попробуйте снова через «Изменить подарки»."); return; }
  const [removed] = state.gifts.splice(index, 1); await writeGiftState(ctx, state);
  await ctx.reply(`${removed.emoji} ${removed.gift_name} убран из корзинки.`);
});

export default composer;
