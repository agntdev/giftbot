import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDO } from "../src/toolkit/session/durable.js";
import { setClockForTests } from "../src/clock.js";

describe("automatic giveaways", () => {
  afterEach(() => { setClockForTests(); vi.unstubAllGlobals(); });

  it("announces an eligible active participant when its durable alarm fires", async () => {
    const values = new Map<string, unknown>();
    const state = {
      storage: {
        get: async <T>(key: string) => values.get(key) as T | undefined,
        put: async (key: string | Record<string, unknown>, value?: unknown) => {
          if (typeof key === "string") values.set(key, value);
          else Object.entries(key).forEach(([name, entry]) => values.set(name, entry));
        },
        delete: async (key: string) => values.delete(key),
        setAlarm: async (at: number) => { values.set("alarm", at); },
        getAlarm: async () => (values.get("alarm") as number | undefined) ?? null,
      },
      blockConcurrencyWhile: () => undefined,
    };
    const current = 1_700_000_000_000;
    setClockForTests(() => current);
    values.set("reminders", []);
    values.set("automatic-gift", { at: current - 1, chatId: -100 });
    values.set("gift-state", {
      participants: [{ user_id: 7, username: "удача", first_name: "Соня", last_seen: current }],
      gifts: [{ emoji: "⭐", gift_name: "Счастливая звезда" }], events: [],
      settings: { locale: "ru", activeWindowMinutes: 30, repeatProtection: 2, intervalMinMinutes: 5, intervalMaxMinutes: 5, mentionFormat: "username", automaticEnabled: true },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const bot = new ChatDO(state, { BOT_TOKEN: "test" } as never);
    await bot.alarm();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.objectContaining({ method: "POST" }));
    expect((values.get("gift-state") as { events: unknown[] }).events).toHaveLength(1);
  });
});
