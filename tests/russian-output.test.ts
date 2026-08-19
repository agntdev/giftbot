import { describe, expect, it, vi } from "vitest";
import { buildBot } from "../src/bot.js";
import { setClockForTests } from "../src/clock.js";
import { ChatDO } from "../src/toolkit/session/durable.js";

function expectRussian(text: string): void {
  expect(text).toMatch(/[А-Яа-яЁё]/u);
  expect(text).not.toMatch(/[A-Za-z]/u);
}

describe("русский интерфейс", () => {
  it("отправляет /start и /gift только по-русски", async () => {
    const bot = await buildBot("123456:TEST");
    bot.botInfo = {
      id: 999,
      is_bot: true,
      first_name: "Бот",
      username: "gift_test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    };
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return {
        ok: true,
        result: { message_id: 1, chat: { id: 1, type: "private" } },
      } as never;
    });
    const update = (id: number, text: string, command = false) => ({
      update_id: id,
      message: {
        message_id: id,
        date: 1_700_000_000,
        chat: { id: 1, type: "private" as const, first_name: "Соня" },
        from: { id: 1, is_bot: false, first_name: "Соня" },
        text,
        ...(command ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.length }] } : {}),
      },
    });

    await bot.handleUpdate(update(1, "/start", true));
    await bot.handleUpdate(update(2, "/gift", true));

    const texts = calls
      .filter((call) => call.method === "sendMessage")
      .map((call) => call.payload.text)
      .filter((text): text is string => typeof text === "string");
    expect(texts).toHaveLength(2);
    texts.forEach(expectRussian);
  });

  it("публикует автоматический розыгрыш по-русски", async () => {
    setClockForTests(() => 1_000_000);
    const values = new Map<string, unknown>();
    values.set("gift-state", {
      participants: [{ user_id: 7, first_name: "Соня", last_seen: 999_999 }],
      gifts: [{ emoji: "🧸", gift_name: "мишка" }],
      events: [],
      settings: {
        locale: "ru", activeWindowMinutes: 30, repeatProtection: 2,
        intervalMinMinutes: 1, intervalMaxMinutes: 90, mentionFormat: "name", automaticEnabled: true,
      },
    });
    values.set("automatic-gift", { at: 999_999, chatId: -100 });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const storage = {
      get: async <T>(key: string): Promise<T | undefined> => values.get(key) as T | undefined,
      put: async (key: string | Record<string, unknown>, value?: unknown): Promise<void> => {
        if (typeof key === "string") values.set(key, value);
        else Object.entries(key).forEach(([entry, saved]) => values.set(entry, saved));
      },
      delete: async (key: string): Promise<boolean> => values.delete(key),
      setAlarm: async (): Promise<void> => undefined,
      getAlarm: async (): Promise<number | null> => null,
    };
    const chat = new ChatDO({ storage, blockConcurrencyWhile: () => undefined } as never, { BOT_TOKEN: "test-token", CHAT_DO: {} as never });

    try {
      await chat.alarm();
      const request = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      const payload = JSON.parse(String(request?.body)) as { text: string };
      expectRussian(payload.text);
    } finally {
      vi.unstubAllGlobals();
      setClockForTests();
    }
  });
});
