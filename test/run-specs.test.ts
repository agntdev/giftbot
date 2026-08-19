import { describe, expect, it } from "vitest";
import { createBot } from "../src/toolkit/bot";
import { formatSuiteResult, parseBotSpec, runSpecs } from "../src/toolkit/harness/run-specs";

function makeToy() {
  const bot = createBot<Record<string, unknown>>("test:TOKEN", { initial: () => ({}) });
  bot.command("start", async (ctx) => {
    await ctx.reply("Hi");
  });
  return bot;
}

describe("runSpecs", () => {
  it("runs each spec against a fresh bot and aggregates pass/fail", async () => {
    const suite = await runSpecs(makeToy, [
      { name: "ok", steps: [{ send: { text: "/start" }, expect: [{ method: "sendMessage", payload: { text: "Hi" } }] }] },
      { name: "bad", steps: [{ send: { text: "/start" }, expect: [{ method: "sendDice" }] }] },
    ]);
    expect(suite.total).toBe(2);
    expect(suite.passed).toBe(1);
    expect(suite.failed).toBe(1);
  });
});

describe("formatSuiteResult", () => {
  it("reports counts and names failing specs", async () => {
    const suite = await runSpecs(makeToy, [
      { name: "bad", steps: [{ send: { text: "/start" }, expect: [{ method: "sendDice" }] }] },
    ]);
    const report = formatSuiteResult(suite);
    expect(report).toContain("bad");
    expect(report).toContain("0/1");
    expect(report).toContain("1 failed");
  });
});

describe("parseBotSpec", () => {
  it("accepts a well-formed spec", () => {
    const spec = parseBotSpec({ name: "x", steps: [{ send: { text: "/s" }, expect: [] }] });
    expect(spec.name).toBe("x");
  });

  it("rejects malformed specs", () => {
    expect(() => parseBotSpec({ steps: [] })).toThrow();
    expect(() => parseBotSpec({ name: "x" })).toThrow();
    expect(() => parseBotSpec({ name: "x", steps: "no" })).toThrow();
    expect(() => parseBotSpec({ name: "x", steps: [{ expect: [] }] })).toThrow();
  });
});
