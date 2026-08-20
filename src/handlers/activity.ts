import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { runDueAutomaticGiveaway, trackParticipant } from "../gift-store.js";

// Every ordinary message is activity. It remains silent unless an automatic
// giveaway is due; crucially, it continues through middleware so no later
// message behavior is accidentally suppressed.
const composer = new Composer<Ctx>();
function isCommand(ctx: Ctx): boolean {
  return ctx.message?.entities?.some((entity) => entity.type === "bot_command" && entity.offset === 0) ?? false;
}

composer.on("message", async (ctx, next) => {
  await trackParticipant(ctx);
  const result = isCommand(ctx) ? undefined : await runDueAutomaticGiveaway(ctx);
  if (result?.kind === "winner") {
    const name = result.participant.username ? `@${result.participant.username}` : result.participant.first_name;
    await ctx.reply(`👏 Победитель: ${name} — получает ${result.gift.emoji} ${result.gift.gift_name}!`);
  }
  await next();
});
export default composer;
