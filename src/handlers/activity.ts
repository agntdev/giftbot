import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { trackParticipant } from "../gift-store.js";

// Ambient activity is intentionally silent: group messages update the durable
// participant index without filling the chat with bot replies. Commands are
// deliberately allowed through so /start, /help, and /gift keep their normal
// handlers; every other message update ends here before the global fallback.
const composer = new Composer<Ctx>();
function isCommand(ctx: Ctx): boolean {
  return ctx.message?.entities?.some(
    (entity) => entity.type === "bot_command" && entity.offset === 0,
  ) ?? false;
}

composer.on("message", async (ctx, next) => {
  await trackParticipant(ctx);

  if (isCommand(ctx)) {
    await next();
    return;
  }

  // Keep this intentionally terse and free of message contents or user data.
  // It is useful when verifying that privacy-mode-delivered group activity is
  // being recorded, without creating user-visible chat noise.
  console.debug("[giftgiver] ignored non-command activity message");
});
export default composer;
