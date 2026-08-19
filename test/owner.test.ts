import { describe, expect, it, vi } from "vitest";
import {
  adminChatId,
  isOwner,
  requireOwner,
} from "../src/toolkit/owner.js";

describe("adminChatId", () => {
  it("prefers ctx.env over process.env (Workers path)", () => {
    const prev = process.env.ADMIN_CHAT_ID;
    process.env.ADMIN_CHAT_ID = "111";
    try {
      expect(
        adminChatId({ env: { ADMIN_CHAT_ID: "222" } }),
      ).toBe("222");
    } finally {
      if (prev === undefined) delete process.env.ADMIN_CHAT_ID;
      else process.env.ADMIN_CHAT_ID = prev;
    }
  });

  it("falls back to process.env when ctx.env is missing (Node/harness)", () => {
    const prev = process.env.ADMIN_CHAT_ID;
    process.env.ADMIN_CHAT_ID = "333";
    try {
      expect(adminChatId({})).toBe("333");
      expect(adminChatId({ env: null })).toBe("333");
    } finally {
      if (prev === undefined) delete process.env.ADMIN_CHAT_ID;
      else process.env.ADMIN_CHAT_ID = prev;
    }
  });

  it("accepts common admin_id key aliases", () => {
    expect(adminChatId({ env: { OWNER_ADMIN_ID: "44" } })).toBe("44");
    expect(adminChatId({ env: { OWNER_TELEGRAM_ID: 55 } })).toBe("55");
    expect(adminChatId({ env: { BOT_ADMIN_ID: " 66 " } })).toBe("66");
  });

  it("returns undefined when no admin key is set", () => {
    const prev = process.env.ADMIN_CHAT_ID;
    delete process.env.ADMIN_CHAT_ID;
    try {
      expect(adminChatId({ env: { OPENAI_API_KEY: "sk-x" } })).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.ADMIN_CHAT_ID = prev;
    }
  });
});

describe("isOwner / requireOwner", () => {
  it("matches from.id or chat.id to the injected admin id", () => {
    const env = { ADMIN_CHAT_ID: "1001" };
    expect(isOwner({ env, from: { id: 1001 } })).toBe(true);
    expect(isOwner({ env, chat: { id: 1001 } })).toBe(true);
    expect(isOwner({ env, from: { id: 9999 } })).toBe(false);
  });

  it("requireOwner allows the owner and denies a stranger", async () => {
    const env = { ADMIN_CHAT_ID: "1001" };
    const ownerReply = vi.fn();
    expect(
      await requireOwner({
        env,
        from: { id: 1001 },
        reply: ownerReply,
      }),
    ).toBe(true);
    expect(ownerReply).not.toHaveBeenCalled();

    const strangerReply = vi.fn();
    const answer = vi.fn();
    expect(
      await requireOwner({
        env,
        from: { id: 9999 },
        reply: strangerReply,
        answerCallbackQuery: answer,
      }),
    ).toBe(false);
    expect(strangerReply).toHaveBeenCalledWith("Only the owner can do that.");
    expect(answer).toHaveBeenCalled();
  });

  it("requireOwner explains when owner id is unset", async () => {
    const prev = process.env.ADMIN_CHAT_ID;
    delete process.env.ADMIN_CHAT_ID;
    try {
      const reply = vi.fn();
      expect(
        await requireOwner({
          env: {},
          from: { id: 1 },
          reply,
        }),
      ).toBe(false);
      expect(reply).toHaveBeenCalledWith("Owner access isn't set up yet.");
    } finally {
      if (prev !== undefined) process.env.ADMIN_CHAT_ID = prev;
    }
  });
});
