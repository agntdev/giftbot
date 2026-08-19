# AGENTS.md — AGNTDEV Telegram bot

A grammY Telegram bot. The AGNTDEV bot toolkit (curated grammY SDK + UI-kit + session storage + test harness) is vendored in `src/toolkit/`. You implement ONE task at
a time so it passes the Tests-gate and merges.

## Setup / build / run
```bash
npm install
npm run build     # tsc -p tsconfig.json → dist/
npm start         # node dist/index.js (needs BOT_TOKEN)
```

## Structure (extend these — do not rearchitect)
- `src/handlers/<slug>.ts` — **add features here** (one file per feature; each
  default-exports a grammY `Composer`). `buildBot()` auto-loads every file in
  this directory at startup. **NEVER edit `src/bot.ts`** to wire in new
  commands — that creates merge conflicts when concurrent PRs each touch the
  same shared file.
- `src/bot.ts` — `buildBot(token)`: assembles the bot, auto-loads all
  `src/handlers/` modules, and registers the unknown-message fallback. Do NOT
  edit this file to add features.
- `src/index.ts` — runtime entry (reads `BOT_TOKEN`, starts the bot).
- `src/harness-entry.ts` — exports `makeBot()` for the Tests-gate (tokenless replay).
- `tests/specs/<slug>.json` — per-feature dialog tests (a `BotSpec` array).
- `tests/commands/<slug>.json` — per-feature declared-command manifest (a JSON string array).

## Adding a feature — BUTTON-FIRST

This bot is **button-driven**: the owners are non-technical and their users
operate the bot by TAPPING, not by typing slash commands. Make every feature
reachable from the `/start` main menu as an inline **button**, NOT a new slash
command. (Slash commands are only for `/start`, `/help`, or free-form typed input
the user already knows how to enter — a search query, note, address, date, time,
or amount. Do NOT add `bot.command("<feature>")` just to make a feature reachable;
that is how bots end up with dozens of cryptic, overlapping commands.)

Create a NEW file `src/handlers/<slug>.ts` that default-exports a grammY
`Composer`. `buildBot()` auto-loads every file in `src/handlers/` at startup, so
your handler is wired up automatically. **NEVER edit `src/bot.ts` or `start.ts`** —
register your menu button with `registerMainMenuItem(...)` and the shipped
`/start` renders it. Each feature touches only its own file, so concurrent PRs
never conflict.

```ts
import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";

// Adds a "📅 Today" button to the /start main menu (no slash command).
registerMainMenuItem({ label: "📅 Today", data: "today:show", order: 20 });

const composer = new Composer<Ctx>();
composer.callbackQuery("today:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Today's bookings: …", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});
export default composer;
```

Friendly copy: short messages, clear button labels (≤1 emoji, no "?"), an
empty-state line ("No bookings yet — tap ➕ to add one."), and plain-language
errors. NEVER show raw IDs, JSON, or stack traces to the user.

Durable data (records, balances, schedules, settings) MUST use the toolkit's
persistent storage, never an in-memory `Map`. The global error boundary and the
unknown-command fallback already live in `buildBot()`/the toolkit — do not
re-add them.

Active-user telemetry (real user count for hosting billing) is AUTOMATIC — the
toolkit records salted user hashes and reports them when the platform injects
`BOT_TELEMETRY_*` at deploy. It is invisible to your code: do not add, read, or
depend on those env vars, and do not build your own user-counting.

## ⚠️ Explicit `.js` import extensions
This is an ESM (`NodeNext`) project. Relative imports MUST carry the `.js`
extension (`import { buildBot } from "./bot.js"`), even from `.ts` files — Node's
runtime requires it. A missing extension can typecheck yet crash at runtime.

## Tests
Each feature writes its OWN `tests/specs/<slug>.json` (a `BotSpec` array: steps of
`{ send, expect }`, where `expect` payloads match as a subset) AND, if it adds a
command, its OWN `tests/commands/<slug>.json` (a JSON string array, e.g.
`["/start"]`). NEVER edit a shared `tests/specs.json` / `tests/commands.json` —
concurrent PRs would conflict. The gate globs `tests/specs/*.json` +
`tests/commands/*.json`.

## Implementation contract (a stub is a FAILURE, even if it compiles)
- **No stubs:** no empty bodies, `TODO`/`FIXME`, commented-out logic, or
  `throw new Error("not implemented")`.
- **No fake data:** no `Math.random()`, hardcoded sample arrays, or canned
  responses standing in for real computed/fetched values.
- **No in-memory data store:** a `Map`/array/module-level variable used as a
  database is a defect. Durable data (anything that must survive a restart) MUST
  use the toolkit's persistent storage (Redis-backed) — not process memory. The
  `Session` type and session storage are for ephemeral conversation state only.
- **Real integrations:** call external APIs against their real contract (correct
  endpoints, ids and params — e.g. a coin *id*, not a ticker), with credentials
  from env.
- **Wire it up:** new commands/handlers must live in `src/handlers/<slug>.ts`
  (auto-loaded by `buildBot()`). Do NOT add handler registrations directly in
  `src/bot.ts`.

If a task is under-specified, implement the smallest REAL slice you can verify
and note the gap — never fake behavior to make the PR look complete.

## ⚡ Runs on Cloudflare Workers — NO Node-only packages

This bot is bundled for the Cloudflare Workers runtime (esbuild, not Node). The
Workers runtime has **no filesystem, no raw TCP/UDP sockets, and no Node core
libraries**. A package that works on Node but reaches for those will pass `tsc`
and the dialog gate, then **fail the build (`npm run build:worker`) and never
deploy** — the tests-gate now rejects it. Do NOT add such packages:

- **Email → use an HTTP API, NOT `nodemailer`/SMTP.** `nodemailer` opens raw SMTP
  sockets and cannot run on Workers. Send mail with `fetch` to a provider's HTTP
  API (e.g. Resend `POST https://api.resend.com/emails`, or SendGrid/Postmark),
  with the API key from an env var. Same for any "send a notification": prefer
  Telegram itself (`ctx.reply` / message the owner) or an HTTP webhook.
- **No Node-only libraries:** avoid anything importing `node:net`/`node:tls`,
  running an HTTP server (`express`, `http.createServer`), spawning processes,
  or touching the filesystem (`fs`). Redis (`ioredis`) and raw Postgres/MySQL
  drivers are Node-only too — use the persistent storage the toolkit provides,
  not your own DB client.
- **Everything external is `fetch` + JSON.** Any third-party service you call
  MUST be reachable over HTTPS and used via `fetch`. If the only client library
  is Node-only, call the REST API directly with `fetch`.
- **Crypto:** use WebCrypto (`crypto.subtle`) — available on Workers — not
  `node:crypto`.

Rule of thumb: if a dependency's README says "for Node.js", it will not bundle.
Reach for a `fetch`-based HTTP API instead.

## Multi-user, storage & time correctness (defects that pass a green build)

These pass `tsc` and the dialog gate but break in production. Honor all of them:

- **Owner / admin identity — platform-injected, never claimed.** When the
  blueprint lists an owner-supplied setting of kind `admin_id` (any key name:
  `ADMIN_CHAT_ID`, `OWNER_ADMIN_ID`, …), the platform already injects the
  project creator's Telegram id at deploy. Read it with the toolkit helpers:

  ```ts
  import { adminChatId, isOwner, requireOwner } from "../toolkit/index.js";

  // notify on new record
  const owner = adminChatId(ctx); // ctx.env first, process.env only as Node fallback
  if (owner) await ctx.api.sendMessage(owner, "…");

  // gate a manage / list / admin button
  composer.callbackQuery("desk:open", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireOwner(ctx))) return;
    // …list records, change status…
  });
  ```

  **NEVER** invent claim-admin / first-`/start`-is-owner / "first user to open
  Admin becomes admin" / open "Manage …" for everyone / `registerAgent` without
  an owner check. **NEVER** read owner/admin secrets from `process.env` alone on
  Workers — secrets live on `ctx.env` (Worker bindings). `process.env` is the
  Node/harness fallback only. If the id is unset, the bot still starts and the
  feature says so plainly ("Owner access isn't set up yet.").
- **Onboarding — never DM a user by id.** A Telegram bot can ONLY message a user
  who has already started it; a cold `sendMessage(userId, …)` to a stranger fails
  with **403**. So NEVER onboard teammates/members by asking an owner to type
  another person's Telegram id. The owner shares an **invite** — a deep link
  `t.me/<bot_username>?start=<code>` or a short join code — and the invitee
  taps/opens it; THAT is when you capture their chat id and record consent
  (opt-in). Wrap every later DM (prompts, reminders, digests) to tolerate a 403
  from someone who never started or has blocked the bot, without aborting the loop.
- **Storage — no keyspace scans.** Durable data uses the toolkit's persistent
  store (above), AND you must never enumerate the keyspace to find records: no
  `KEYS`, `SCAN`, `readAll`, or "list every key with this prefix" (an O(N) hazard
  that blocks Redis). Keep explicit **index records** (e.g. a team's `memberIds[]`,
  a `days[]` list, a per-user `userId -> teamId` pointer) and read through them.
- **Time — use an injectable clock.** Route every schedule, cutoff, "today",
  expiry, and late/on-time decision through ONE `now()` seam you can override in a
  test, not inline `new Date()` / `Date.now()`. Time-based behavior a test cannot
  drive is unverifiable — and a scheduled/cutoff feature is what silently breaks.
- **Owner desk (when the bot has private records for the owner).** If the bot
  collects records the owner must act on (leads, bookings, requests): (1) notify
  the owner via `adminChatId(ctx)`, (2) give the owner an in-bot list + status
  change, (3) hard-deny that path with `requireOwner(ctx)`. Do not ship
  notify-only, and do not ship an open Manage screen for strangers.
