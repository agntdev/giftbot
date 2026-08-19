import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { trackParticipant } from "../gift-store.js";

// Ambient activity is intentionally silent: group messages update the durable
// participant index without filling the chat with bot replies.
const composer = new Composer<Ctx>();
composer.on("message", async (ctx, next) => { await trackParticipant(ctx); await next(); });
export default composer;
