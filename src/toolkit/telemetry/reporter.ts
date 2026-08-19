// =============================================================================
// Active-user reporter (agnt-api migration 00069).
//
// The platform bills bot hosting by real active users, but Telegram exposes no
// per-bot user stat and the platform never sees this bot's updates. So the bot
// self-reports: on each end-user interaction it records a SALTED HASH of the
// user id (never the raw id) and periodically POSTs the batch to the ingestion
// endpoint, authenticated by a per-bot HMAC over the raw body.
//
// Entirely env-gated: with BOT_TELEMETRY_URL/SECRET/SALT unset (old bots, the
// test harness, the feature off) nothing is installed and the bot is unchanged.
// Best-effort throughout — telemetry must NEVER break the bot.
// =============================================================================

/** Per-bot telemetry credential, injected as env vars at deploy. */
export interface TelemetryConfig {
  /** Full ingestion URL, already carrying this bot's project id. */
  url: string;
  /** Per-bot HMAC signing key (hex). */
  secret: string;
  /** Per-bot user-hash salt (hex). */
  salt: string;
}

/** The telemetry-only subset of a Node process environment or Worker bindings. */
export interface TelemetryEnv {
  BOT_TELEMETRY_URL?: string;
  BOT_TELEMETRY_SECRET?: string;
  BOT_TELEMETRY_SALT?: string;
}

/**
 * telemetryConfigFromEnv reads the credential from the environment. Returns null
 * when any var is missing — the caller then installs nothing (graceful no-op).
 */
export function telemetryConfigFromEnv(
  env: TelemetryEnv = typeof process === "undefined" ? {} : process.env,
): TelemetryConfig | null {
  const url = env.BOT_TELEMETRY_URL;
  const secret = env.BOT_TELEMETRY_SECRET;
  const salt = env.BOT_TELEMETRY_SALT;
  if (!url || !secret || !salt) return null;
  return { url, secret, salt };
}

// Crypto via WebCrypto (crypto.subtle): the ONE implementation that exists on
// both Node ≥20 and Cloudflare Workers. A node:crypto import here would ride
// into the Workers bundle (this module is reachable from toolkit/index) and
// Cloudflare rejects any static node:* import at upload.
const hexOf = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * hashUser hashes a Telegram user id with the per-bot salt. MUST match the
 * server's utils.HashBotUser: sha256( salt + ":" + decimal(userId) ), hex.
 */
export async function hashUser(salt: string, userId: number): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${userId}`);
  return hexOf(await crypto.subtle.digest("SHA-256", data));
}

/** signBody builds the X-Bot-Signature-256 value: "sha256=" + HMAC-SHA256(body). */
export async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return "sha256=" + hexOf(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

/** One reported activity event: hashed user + unix-seconds last seen. */
export interface ActivityEvent {
  u: string;
  t: number;
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>;

export interface ReporterOptions {
  /** Flush interval in ms (default 5 min). */
  flushMs?: number;
  /** Flush eagerly once the buffer reaches this many distinct users (default 1000; the server caps at 5000/batch). */
  maxBatch?: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Send each update immediately. Required for request-scoped Worker runtimes. */
  flushOnRecord?: boolean;
  /** Disable the periodic timer when the runtime cannot keep it alive. */
  startTimer?: boolean;
}

/**
 * ActivityReporter accumulates distinct end-users (keeping the latest seen time
 * per user) and flushes them to the ingestion endpoint. Deduplication + the
 * 30-day window + owner exclusion all happen server-side; the bot only reports
 * salted hashes.
 */
export class ActivityReporter {
  private seen = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly cfg: TelemetryConfig,
    private readonly opts: ReporterOptions = {},
  ) {}

  /** record notes that a user interacted with the bot (at `atMs`, default now). */
  async record(userId: number, atMs: number = Date.now()): Promise<void> {
    this.seen.set(await hashUser(this.cfg.salt, userId), Math.floor(atMs / 1000));
    if (this.opts.flushOnRecord || this.seen.size >= (this.opts.maxBatch ?? 1000)) {
      await this.flush();
    }
  }

  /** Number of distinct users currently buffered (for tests / diagnostics). */
  get pending(): number {
    return this.seen.size;
  }

  /**
   * flush POSTs the current batch and clears it. Best-effort: on any failure the
   * batch is dropped (not retried) so telemetry never blocks or breaks the bot.
   * Returns the number of events sent.
   */
  async flush(): Promise<number> {
    if (this.seen.size === 0) return 0;
    const batch = this.seen;
    this.seen = new Map();
    const events: ActivityEvent[] = [...batch].map(([u, t]) => ({ u, t }));
    const body = JSON.stringify({ events });
    const doFetch = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    try {
      await doFetch(this.cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Bot-Signature-256": await signBody(this.cfg.secret, body),
        },
        body,
      });
    } catch {
      // best-effort: dropped batch is fine; the next flush carries fresh users.
    }
    return events.length;
  }

  /** start begins the periodic flush timer (unref'd so it never keeps the process alive). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushMs ?? 5 * 60 * 1000);
    this.timer.unref?.();
  }

  /** stop cancels the flush timer (for graceful shutdown / tests). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

/** The minimal bot surface the installer needs (grammY's Bot satisfies it). */
export interface UsableBot {
  use(middleware: (ctx: { from?: { id?: number } }, next: () => Promise<void>) => unknown): void;
}

/**
 * installActivityReporter wires the reporter into a bot: a middleware records
 * every update carrying an end-user, and the flush timer starts. No-op (returns
 * null) when the telemetry env is unset — so old bots and the test harness are
 * unaffected. Called by createBot; also exported for explicit wiring/testing.
 */
export function installActivityReporter(
  bot: UsableBot,
  env: TelemetryEnv = typeof process === "undefined" ? {} : process.env,
  opts: ReporterOptions = {},
): ActivityReporter | null {
  const cfg = telemetryConfigFromEnv(env);
  if (!cfg) return null;
  const reporter = new ActivityReporter(cfg, opts);
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (typeof id === "number") {
      try {
        await reporter.record(id);
      } catch {
        // telemetry must NEVER break the bot
      }
    }
    return next();
  });
  if (opts.startTimer !== false) reporter.start();
  return reporter;
}
