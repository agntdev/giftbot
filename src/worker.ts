/**
 * Cloudflare Workers entry point (docs/cloudflare/new-projects-on-cf.md §1, §3).
 *
 * Telegram delivers each update as a webhook POST to /tg; the Worker builds the
 * grammY bot (once per isolate) with the build-time handler manifest and a
 * Durable-Object session store, then hands the request to grammY's Workers
 * adapter. Reminders run on Durable Object alarms (see toolkit/session/durable).
 *
 * The Node/long-poll entry (src/index.ts) is untouched — a bot deployed to Fly
 * still runs there. Only a bot whose agnt engine is `cloudflare` is served here.
 */

import { webhookCallback, Composer, type Bot } from "grammy";
import { buildBot, type Ctx } from "./bot.js";
import { handlers } from "./handlers.generated.js";
import { createDurableSessionStorage, type WorkerEnv } from "./toolkit/session/durable.js";

export { ChatDO } from "./toolkit/session/durable.js";

// A grammY context under Workers additionally carries the runtime `env`, so a
// handler can reach bindings + helpers (e.g. remindAt(ctx.env, …), ctx.env.DB).
export type WorkerCtx = Ctx & { env: WorkerEnv };

// Build the bot ONCE per isolate. The token is stable for the isolate's
// lifetime; grammY requires init() before handling updates. A FAILED build is
// NOT cached: isolates live for many requests, so caching a rejected promise
// (e.g. one transient getMe timeout during a cold start) would brick every
// subsequent update until Cloudflare happens to recycle the isolate.
let botPromise: Promise<Bot<Ctx>> | null = null;
function getBot(env: WorkerEnv): Promise<Bot<Ctx>> {
  if (!botPromise) {
    botPromise = (async () => {
      // Expose the runtime env to handlers (Workers-only; the harness never sets
      // it) BEFORE they run — a handler reaches bindings + helpers through it
      // (remindAt(ctx.env, …), ctx.env.DB). buildBot installs `handlers` in array
      // order, so this must be the FIRST entry, not a trailing bot.use() (which
      // would run AFTER the feature handlers and leave ctx.env undefined).
      const attachEnv = new Composer<Ctx>();
      attachEnv.use((ctx, next) => {
        (ctx as WorkerCtx).env = env;
        return next();
      });
      const bot = await buildBot(env.BOT_TOKEN, {
        handlers: [attachEnv, ...handlers],
        storage: createDurableSessionStorage(env),
        // Worker isolates are request-scoped: they do not expose secrets through
        // process.env and cannot reliably keep a five-minute interval alive.
        telemetryEnv: env,
        telemetryReporterOptions: { flushOnRecord: true, startTimer: false },
      });
      await bot.init();
      return bot;
    })();
    botPromise.catch(() => {
      botPromise = null;
    });
  }
  return botPromise;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "cloudflare-workers" });
    }

    if (request.method === "POST" && url.pathname === "/tg") {
      // Telegram echoes the secret we registered with setWebhook; reject anything
      // that doesn't match so only Telegram can drive the bot.
      if (
        env.WEBHOOK_SECRET &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
      ) {
        return new Response("forbidden", { status: 403 });
      }
      const bot = await getBot(env);
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    return new Response("not found", { status: 404 });
  },
};
