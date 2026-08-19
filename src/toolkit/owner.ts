/**
 * Trusted owner / admin identity from platform-injected env (kind admin_id).
 *
 * Cloudflare Workers do not put deploy secrets on `process.env`. Bindings land
 * on the Worker `env` object and are exposed to handlers as `ctx.env` (see
 * src/worker.ts). Reading only `process.env.ADMIN_*` passes the Node harness
 * and dies in production (live: propleadbot, 2026-07-31).
 *
 * Key *names* vary by blueprint (`ADMIN_CHAT_ID`, `OWNER_ADMIN_ID`, …). The
 * platform classifies them as kind `admin_id` and autofills the project
 * creator's Telegram id. This helper accepts the common aliases; prefer
 * `adminChatId` / `requireOwner` over inventing claim-admin or open Manage.
 */

/** Common platform names for env keys of kind admin_id. */
export const ADMIN_ID_ENV_KEYS = [
  "ADMIN_CHAT_ID",
  "OWNER_ADMIN_ID",
  "OWNER_TELEGRAM_ID",
  "ADMIN_TELEGRAM_ID",
  "OWNER_CHAT_ID",
  "BOT_ADMIN_ID",
  "ADMIN_ID",
  "OWNER_ID",
  "OWNER_ALERT_CHAT_ID",
  "ADMIN_NOTIFICATION_CHAT_ID",
] as const;

/** Minimal ctx shape — works with grammY Ctx and plain unit-test stubs. */
export type OwnerAwareCtx = {
  env?: Record<string, unknown> | null;
  from?: { id: number } | undefined;
  chat?: { id: number } | undefined;
  reply: (text: string, ...args: unknown[]) => unknown | Promise<unknown>;
  answerCallbackQuery?: (
    opts?: { text?: string; show_alert?: boolean },
  ) => unknown | Promise<unknown>;
};

function coerceId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

function readAdminFromEnv(
  env: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!env) return undefined;
  for (const key of ADMIN_ID_ENV_KEYS) {
    const id = coerceId(env[key]);
    if (id !== undefined) return id;
  }
  return undefined;
}

function nodeProcessEnv(): Record<string, unknown> | undefined {
  // Workers / edge: no process. Harness + Node long-poll: secrets may live here.
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env as unknown as Record<string, unknown>;
}

/**
 * Platform-injected owner/admin chat id, or `undefined` if unset.
 * Prefer `ctx.env` (Workers); fall back to `process.env` only for Node/harness.
 */
export function adminChatId(ctx: {
  env?: Record<string, unknown> | null;
}): string | undefined {
  return (
    readAdminFromEnv(ctx.env ?? undefined) ?? readAdminFromEnv(nodeProcessEnv())
  );
}

/** True when the update's user (or private chat) matches the injected owner id. */
export function isOwner(ctx: {
  env?: Record<string, unknown> | null;
  from?: { id: number } | undefined;
  chat?: { id: number } | undefined;
}): boolean {
  const admin = adminChatId(ctx);
  if (admin === undefined) return false;
  if (ctx.from?.id !== undefined && String(ctx.from.id) === admin) return true;
  // Private chats: chat id equals user id — notify targets often use chat id.
  if (ctx.chat?.id !== undefined && String(ctx.chat.id) === admin) return true;
  return false;
}

/**
 * Gate a manage / list / admin action. Returns true if the caller may proceed.
 * On deny: answers callback (when present) and replies in plain language.
 * Does not throw — callers should `return` when this is false.
 */
export async function requireOwner(ctx: OwnerAwareCtx): Promise<boolean> {
  if (isOwner(ctx)) return true;

  const unset = adminChatId(ctx) === undefined;
  const text = unset
    ? "Owner access isn't set up yet."
    : "Only the owner can do that.";

  try {
    if (ctx.answerCallbackQuery) {
      await ctx.answerCallbackQuery({ text, show_alert: true });
    }
  } catch {
    // Non-fatal: still reply in chat.
  }
  await ctx.reply(text);
  return false;
}
