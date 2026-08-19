import {
  Bot,
  session,
  type Context,
  type SessionFlavor,
  type StorageAdapter,
} from "grammy";
import { resolveSessionStorage } from "./session/redis.js";
import {
  installActivityReporter,
  type ReporterOptions,
  type TelemetryEnv,
} from "./telemetry/reporter.js";

/** Context for a toolkit bot carrying a typed session `S`. */
export type BotContext<S extends object = Record<string, unknown>> = Context & SessionFlavor<S>;

export interface CreateBotOptions<S extends object> {
  /** Initial session value for a new chat. */
  initial: () => S;
  /**
   * Session storage. When omitted, the toolkit auto-selects: Redis if
   * REDIS_URL is set in the environment (production), else in-memory
   * (development / no Redis). Pass an explicit adapter to override.
   */
  storage?: StorageAdapter<S>;
  /** Worker bindings; omitted on Node, where the reporter reads process.env. */
  telemetryEnv?: TelemetryEnv;
  /** Runtime-specific reporter behavior, such as per-update Worker flushing. */
  telemetryReporterOptions?: ReporterOptions;
  /** Called on any unhandled handler error; defaults to console.error. */
  onError?: (err: unknown) => void;
}

/**
 * createBot — the toolkit's curated entry point. Wraps grammY's Bot with the
 * default session middleware and an error boundary, so every generated bot
 * shares one opinionated structure: the Dev-stage codegen targets this API, and
 * the test harness (M0-10) replays Updates against bots built here.
 *
 * The BotFather token is injected at runtime (never baked); polling vs webhook
 * is chosen at deploy time (docs/pivot M1-7).
 */
export function createBot<S extends object>(
  token: string,
  opts: CreateBotOptions<S>,
): Bot<BotContext<S>> {
  const bot = new Bot<BotContext<S>>(token);
  bot.use(
    session<S, BotContext<S>>({
      initial: opts.initial,
      // Auto-select: explicit adapter → Redis (REDIS_URL) → in-memory.
      storage: resolveSessionStorage<S>(opts.storage),
    }),
  );
  // Active-user reporting (agnt-api migration 00069). No-op unless the platform
  // injected BOT_TELEMETRY_* at deploy — so dev, the test harness, and old bots
  // are byte-for-byte unchanged. Records salted user hashes only; best-effort.
  installActivityReporter(bot, opts.telemetryEnv, opts.telemetryReporterOptions);
  bot.catch((err) => {
    if (opts.onError) opts.onError(err);
    else console.error("[agntdev-bot] unhandled error:", err);
  });
  return bot;
}

/**
 * Publish the bot's slash-command menu to Telegram (the "/" list + Menu button),
 * so the few commands a button-first bot DOES expose are discoverable. A
 * button-first bot should publish only `/start` and `/help` (plus any rare
 * free-form-input command); everything else is reached by tapping a menu button.
 *
 * Call once at startup (see `src/index.ts`). No-ops harmlessly under the test
 * harness (the Bot API transport is faked there). `extra` appends bot-specific
 * commands beyond the `/start` + `/help` defaults.
 */
export async function setDefaultCommands<S extends object>(
  bot: Bot<BotContext<S>>,
  extra: ReadonlyArray<{ command: string; description: string }> = [],
): Promise<void> {
  const commands = [
    { command: "start", description: "Open the menu" },
    { command: "help", description: "How this bot works" },
    ...extra,
  ];
  try {
    await bot.api.setMyCommands(commands);
  } catch {
    // Non-fatal: discoverability only. Never block startup on it.
  }
}
