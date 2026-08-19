import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { readGiftState, runGiveaway, trackParticipant, writeGiftState, type Gift } from "../gift-store.js";
import { now } from "../clock.js";

registerMainMenuItem({ label: "🎁 Give a gift", data: "gift:run", order: 10 });
registerMainMenuItem({ label: "⚙️ Giveaway settings", data: "gift:settings", order: 20 });

const composer = new Composer<Ctx>();

async function mayManage(ctx: Ctx): Promise<boolean> {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    await ctx.answerCallbackQuery({ text: "Open this in your group to manage giveaways.", show_alert: true });
    return false;
  }
  if (!ctx.from) return false;
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (member.status === "creator" || member.status === "administrator") return true;
  } catch {
    // Telegram only reveals this when the bot can inspect the group membership.
  }
  await ctx.answerCallbackQuery({ text: "Only a group admin can change giveaway settings.", show_alert: true });
  return false;
}

// Every settings action is owner-controlled by the Telegram group itself.
composer.callbackQuery(/^gift:(settings|gifts|add|remove|window|repeat|auto|interval|mention)/, async (ctx, next) => {
  if (!(await mayManage(ctx))) return;
  await next();
});

function homeKeyboard() {
  return inlineKeyboard([[inlineButton("🎁 Give a gift", "gift:run")], [inlineButton("⬅️ Back to menu", "menu:main")]]);
}
function settingsKeyboard() {
  return inlineKeyboard([
    [inlineButton("🎁 Edit gifts", "gift:gifts"), inlineButton("⏱ Active window", "gift:window")],
    [inlineButton("🛡 Repeat protection", "gift:repeat"), inlineButton("🔁 Auto giveaways", "gift:auto")],
    [inlineButton("💬 Mention style", "gift:mention"), inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}
function winnerName(person: { username?: string; first_name: string }, mention: "username" | "name"): string {
  return mention === "username" && person.username ? `@${person.username}` : person.first_name;
}
function resultText(result: Awaited<ReturnType<typeof runGiveaway>>, mention: "username" | "name"): string {
  if (result.kind === "winner") return `🎁 ${winnerName(result.participant, mention)} wins ${result.gift.emoji} ${result.gift.gift_name}! Lucky you!`;
  if (result.kind === "empty-gifts") return "The gift basket is empty — an admin can add a treat in Giveaway settings.";
  if (result.kind === "no-active") return "No one has been active lately — let the chat warm up, then try again.";
  return "Everyone active has won recently — give the chat a moment, then try again.";
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
  await ctx.editMessageText("Tune your giveaways here. Pick a setting to change.", { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:gifts", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx);
  const list = state.gifts.map((gift) => `${gift.emoji} ${gift.gift_name}`).join("\n") || "No gifts yet";
  await ctx.editMessageText(`Your gift basket:\n${list}`, { reply_markup: inlineKeyboard([
    [inlineButton("➕ Add a gift", "gift:add"), inlineButton("➖ Remove a gift", "gift:remove")],
    [inlineButton("⬅️ Settings", "gift:settings")],
  ]) });
});

composer.callbackQuery("gift:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.giftFlow = "add-gift";
  ctx.session.giftFlowStartedAt = now();
  await ctx.reply("Send the gift as an emoji and name, like 🎈 Balloon.", { reply_markup: { force_reply: true, input_field_placeholder: "🎈 Balloon" } });
});

composer.callbackQuery("gift:remove", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.giftFlow = "remove-gift";
  ctx.session.giftFlowStartedAt = now();
  await ctx.reply("Send the exact gift name you want to remove.", { reply_markup: { force_reply: true, input_field_placeholder: "Gift name" } });
});

composer.callbackQuery("gift:window", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("How recently should someone have chatted?", { reply_markup: inlineKeyboard([
    [inlineButton("15 minutes", "gift:window:15"), inlineButton("30 minutes", "gift:window:30"), inlineButton("60 minutes", "gift:window:60")],
    [inlineButton("⬅️ Settings", "gift:settings")],
  ]) });
});

composer.callbackQuery(/^gift:window:(15|30|60)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const minutes = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.activeWindowMinutes = minutes; await writeGiftState(ctx, state);
  await ctx.editMessageText(`Active window set to ${minutes} minutes.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:repeat", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("How many recent winners should sit out?", { reply_markup: inlineKeyboard([
    [inlineButton("1 winner", "gift:repeat:1"), inlineButton("2 winners", "gift:repeat:2"), inlineButton("3 winners", "gift:repeat:3")],
    [inlineButton("⬅️ Settings", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:repeat:(1|2|3)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const value = Number(ctx.match[1]); const state = await readGiftState(ctx);
  state.settings.repeatProtection = value; await writeGiftState(ctx, state);
  await ctx.editMessageText(`The last ${value} winner${value === 1 ? "" : "s"} will sit out.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:auto", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx);
  const status = state.settings.automaticEnabled ? "on" : "off";
  await ctx.editMessageText(`Automatic giveaways are ${status}.`, { reply_markup: inlineKeyboard([
    [inlineButton("Turn on", "gift:auto:on"), inlineButton("Turn off", "gift:auto:off")],
    [inlineButton("5–30 minutes", "gift:interval:5:30"), inlineButton("30–90 minutes", "gift:interval:30:90")],
    [inlineButton("⬅️ Settings", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:auto:(on|off)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const on = ctx.match[1] === "on"; const state = await readGiftState(ctx);
  state.settings.automaticEnabled = on; await writeGiftState(ctx, state);
  await ctx.editMessageText(on ? "Automatic giveaways are on — let the fun begin!" : "Automatic giveaways are paused.", { reply_markup: settingsKeyboard() });
});
composer.callbackQuery(/^gift:interval:(5|30):(30|90)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx); state.settings.intervalMinMinutes = Number(ctx.match[1]); state.settings.intervalMaxMinutes = Number(ctx.match[2]); await writeGiftState(ctx, state);
  await ctx.editMessageText(`Auto giveaways will land every ${ctx.match[1]}–${ctx.match[2]} minutes.`, { reply_markup: settingsKeyboard() });
});

composer.callbackQuery("gift:mention", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("How should winners be named?", { reply_markup: inlineKeyboard([
    [inlineButton("Use @username", "gift:mention:username"), inlineButton("Use first name", "gift:mention:name")],
    [inlineButton("⬅️ Settings", "gift:settings")],
  ]) });
});
composer.callbackQuery(/^gift:mention:(username|name)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await readGiftState(ctx); state.settings.mentionFormat = ctx.match[1] as "username" | "name"; await writeGiftState(ctx, state);
  await ctx.editMessageText(`Winner names will use ${ctx.match[1] === "username" ? "@usernames when available" : "first names"}.`, { reply_markup: settingsKeyboard() });
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.giftFlow;
  if (!flow || ctx.message.text.startsWith("/")) return next();
  if ((ctx.session.giftFlowStartedAt ?? 0) + 5 * 60_000 < now()) {
    ctx.session.giftFlow = undefined;
    ctx.session.giftFlowStartedAt = undefined;
    await ctx.reply("That gift edit timed out — tap Edit gifts to start again.");
    return;
  }
  const input = ctx.message.text.trim(); const state = await readGiftState(ctx);
  ctx.session.giftFlow = undefined;
  ctx.session.giftFlowStartedAt = undefined;
  if (flow === "add-gift") {
    const match = input.match(/^(\S+)\s+(.+)$/);
    if (!match) { await ctx.reply("That needs an emoji and a name, like 🎈 Balloon. Try again from Edit gifts."); return; }
    state.gifts.push({ emoji: match[1], gift_name: match[2].slice(0, 60) }); await writeGiftState(ctx, state);
    await ctx.reply(`${match[1]} ${match[2].slice(0, 60)} is in the basket!`); return;
  }
  const index = state.gifts.findIndex((gift: Gift) => gift.gift_name.toLowerCase() === input.toLowerCase());
  if (index < 0) { await ctx.reply("I couldn't find that gift. Check the name and try again from Edit gifts."); return; }
  const [removed] = state.gifts.splice(index, 1); await writeGiftState(ctx, state);
  await ctx.reply(`${removed.emoji} ${removed.gift_name} is out of the basket.`);
});

export default composer;
