import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { buildBot } from "../src/bot";
import { formatSuiteResult, parseBotSpecs, runSpecs } from "../src/toolkit/harness/run-specs";

// THE PUBLISH GATE replays every tests/specs/*.json against your built bot via the
// toolkit harness, and fails the build on any mismatch. This test runs the SAME
// replay locally so `npm test` catches handler-reply-vs-spec drift BEFORE the gate
// does — the single most common reason a green build still fails to publish.
//
// If this fails, a handler's reply text doesn't match its spec's expected text:
// the report names the spec + the exact step + expected-vs-actual call. Make one
// match the other. (Do NOT delete this file — it is your local mirror of the gate.)
const SPECS_DIR = join(process.cwd(), "tests", "specs");

describe("dialog specs (the publish gate replays these)", () => {
  it("every tests/specs/*.json spec passes against the real bot", async () => {
    if (!existsSync(SPECS_DIR)) return; // no specs authored yet
    const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return;
    const specs = files.flatMap((f) =>
      parseBotSpecs(JSON.parse(readFileSync(join(SPECS_DIR, f), "utf8"))),
    );
    const suite = await runSpecs(() => buildBot("123456:TEST"), specs);
    expect(suite.failed, "\n" + formatSuiteResult(suite)).toBe(0);
  });
});
