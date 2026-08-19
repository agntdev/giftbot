import { describe, expect, it } from "vitest";
import { createBot } from "../src/toolkit/bot";
import { inlineButton, inlineKeyboard } from "../src/toolkit/ui/keyboard";
import { runSpec } from "../src/toolkit/harness/runner";

interface S {
  count: number;
}

function toyBot() {
  const bot = createBot<S>("test:TOKEN", { initial: () => ({ count: 0 }) });
  bot.command("start", async (ctx) => {
    await ctx.reply("Welcome", {
      reply_markup: inlineKeyboard([[inlineButton("Next", "menu:next")]]),
    });
  });
  bot.callbackQuery("menu:next", async (ctx) => {
    await ctx.answerCallbackQuery(); // incidental — clears the loading spinner
    await ctx.editMessageText("Page 2");
  });
  bot.command("boom", async () => {
    throw new Error("kaboom");
  });
  return bot;
}

describe("replay harness", () => {
  it("passes when the bot emits the expected call (subset payload)", async () => {
    const res = await runSpec(toyBot(), {
      name: "start",
      steps: [
        { send: { text: "/start" }, expect: [{ method: "sendMessage", payload: { text: "Welcome" } }] },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("allows incidental extra calls under subsequence matching", async () => {
    const res = await runSpec(toyBot(), {
      name: "next",
      steps: [
        { send: { callback: "menu:next" }, expect: [{ method: "editMessageText", payload: { text: "Page 2" } }] },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("fails when an expected call is missing", async () => {
    const res = await runSpec(toyBot(), {
      name: "wrong",
      steps: [{ send: { text: "/start" }, expect: [{ method: "sendDice" }] }],
    });
    expect(res.ok).toBe(false);
  });

  it("strict mode rejects incidental extra calls", async () => {
    const res = await runSpec(toyBot(), {
      name: "strict-next",
      strict: true,
      steps: [{ send: { callback: "menu:next" }, expect: [{ method: "editMessageText" }] }],
    });
    expect(res.ok).toBe(false);
  });

  it("surfaces handler exceptions in the step result", async () => {
    const res = await runSpec(toyBot(), {
      name: "boom",
      steps: [{ send: { text: "/boom" }, expect: [] }],
    });
    expect(res.ok).toBe(false);
    expect(res.steps[0]?.error).toContain("kaboom");
  });

  it("captures a FLOATED Bot API call (handler didn't await) in the same step", async () => {
    // The handler schedules its reply on a later MACROTASK and does NOT await it,
    // so handleUpdate resolves (and the naive calls.slice would run) before the
    // call fires. The runner's settle() drain — itself a setTimeout(0) registered
    // AFTER the handler's — lets the floated call land first, attributing it to
    // THIS step. Without the drain the call escapes the step entirely.
    const bot = createBot<S>("test:TOKEN", { initial: () => ({ count: 0 }) });
    bot.command("floaty", (ctx) => {
      setTimeout(() => {
        void ctx.reply("floated");
      }, 0);
      // returns undefined synchronously — the reply is intentionally un-awaited
    });
    const res = await runSpec(bot, {
      name: "floaty",
      steps: [{ send: { text: "/floaty" }, expect: [{ method: "sendMessage", payload: { text: "floated" } }] }],
    });
    expect(res.ok).toBe(true);
    expect(res.steps[0]?.captured.map((c) => c.method)).toContain("sendMessage");
  });
});
