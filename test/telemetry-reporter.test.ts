import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ActivityReporter,
  hashUser,
  installActivityReporter,
  signBody,
  telemetryConfigFromEnv,
  type ActivityEvent,
} from "../src/toolkit/telemetry/reporter";

const cfg = { url: "https://api.example/act", secret: "s3cr3t", salt: "saltA" };

describe("telemetryConfigFromEnv", () => {
  it("returns null unless all three vars are set (graceful no-op)", () => {
    expect(telemetryConfigFromEnv({})).toBeNull();
    expect(telemetryConfigFromEnv({ BOT_TELEMETRY_URL: "u", BOT_TELEMETRY_SECRET: "s" })).toBeNull();
    expect(
      telemetryConfigFromEnv({ BOT_TELEMETRY_URL: "u", BOT_TELEMETRY_SECRET: "s", BOT_TELEMETRY_SALT: "z" }),
    ).toEqual({ url: "u", secret: "s", salt: "z" });
  });
});

describe("hashUser", () => {
  it("matches the server scheme sha256(salt + ':' + id) — node:crypto cross-check", async () => {
    const want = createHash("sha256").update("saltA:123").digest("hex");
    expect(await hashUser("saltA", 123)).toBe(want);
  });
  it("is salt-dependent (no cross-bot correlation)", async () => {
    expect(await hashUser("saltA", 123)).not.toBe(await hashUser("saltB", 123));
  });
});

describe("signBody", () => {
  it("produces a sha256= prefixed hex HMAC — node:crypto cross-check", async () => {
    const sig = await signBody("k", "body");
    expect(sig.startsWith("sha256=")).toBe(true);
    const want = "sha256=" + createHmac("sha256", "k").update("body").digest("hex");
    expect(sig).toBe(want);
  });
});

describe("ActivityReporter", () => {
  it("dedupes users, signs the body, and POSTs the batch", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetchSpy = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return {};
    });
    const r = new ActivityReporter(cfg, { fetch: fetchSpy });

    await r.record(1, 2_000_000);
    await r.record(2, 2_000_000);
    await r.record(1, 3_000_000); // same user, newer → dedupes to 2 distinct
    expect(r.pending).toBe(2);

    const sent = await r.flush();
    expect(sent).toBe(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(calls[0].url).toBe(cfg.url);

    const events = (JSON.parse(calls[0].body) as { events: ActivityEvent[] }).events;
    expect(events).toHaveLength(2);
    // Newest ts kept for user 1.
    const u1hash = await hashUser(cfg.salt, 1);
    expect(events.find((e) => e.u === u1hash)?.t).toBe(3000);
    // Signature matches the exact body under the secret.
    expect(calls[0].headers["X-Bot-Signature-256"]).toBe(await signBody(cfg.secret, calls[0].body));

    // Buffer cleared after flush; a no-op flush sends nothing.
    expect(r.pending).toBe(0);
    expect(await r.flush()).toBe(0);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("never throws when the POST fails (best-effort)", async () => {
    const r = new ActivityReporter(cfg, {
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await r.record(9);
    await expect(r.flush()).resolves.toBe(1); // reported count, error swallowed
  });

  it("flushes eagerly when the batch cap is reached", async () => {
    const fetchSpy = vi.fn(async () => ({}));
    const r = new ActivityReporter(cfg, { fetch: fetchSpy, maxBatch: 2 });
    await r.record(1);
    await r.record(2); // hits cap → eager flush (async: signBody awaits inside)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
  });

  it("flushes each update when configured for a request-scoped Worker", async () => {
    const fetchSpy = vi.fn(async () => ({}));
    const r = new ActivityReporter(cfg, { fetch: fetchSpy, flushOnRecord: true, startTimer: false });

    await r.record(42);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(r.pending).toBe(0);
  });
});

describe("installActivityReporter", () => {
  it("returns null and installs nothing when unconfigured", () => {
    const bot = { use: vi.fn() };
    expect(installActivityReporter(bot, {})).toBeNull();
    expect(bot.use).not.toHaveBeenCalled();
  });

  it("records ctx.from.id via middleware when configured", async () => {
    let mw: ((ctx: { from?: { id?: number } }, next: () => Promise<void>) => unknown) | undefined;
    const bot = { use: (m: typeof mw) => { mw = m; } };
    const r = installActivityReporter(bot, {
      BOT_TELEMETRY_URL: cfg.url,
      BOT_TELEMETRY_SECRET: cfg.secret,
      BOT_TELEMETRY_SALT: cfg.salt,
    });
    expect(r).not.toBeNull();
    r?.stop(); // don't leave a timer running

    let nexted = false;
    await mw?.({ from: { id: 555 } }, async () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(r?.pending).toBe(1);

    // Updates without a user id are ignored.
    await mw?.({}, async () => {});
    expect(r?.pending).toBe(1);
  });
});
