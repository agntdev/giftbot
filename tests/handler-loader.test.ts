import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildBot } from "../src/bot.js";
import { runSpecs, parseBotSpec } from "../src/toolkit/index.js";

describe("buildBot handler loader", () => {
  it("loads src/handlers/start.ts so /start replies via the harness", async () => {
    const raw = JSON.parse(
      readFileSync(new URL("./specs/start.json", import.meta.url), "utf8"),
    ) as unknown[];
    const specs = raw.map(parseBotSpec);
    const suite = await runSpecs(() => buildBot("test-token"), specs);
    expect(suite.failed).toBe(0);
    expect(suite.passed).toBeGreaterThan(0);
  });

  it("ordinary input is silent after activity tracking", async () => {
    const suite = await runSpecs(() => buildBot("test-token"), [
      parseBotSpec({
        name: "ordinary text produces no Bot API calls",
        strict: true,
        steps: [
          { send: { text: "qwerty" },
            expect: [] },
        ],
      }),
    ]);
    expect(suite.failed).toBe(0);
  });
});
