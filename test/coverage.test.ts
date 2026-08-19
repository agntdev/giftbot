import { describe, expect, it } from "vitest";
import {
  commandsInSpec,
  commandsInSpecs,
  computeCoverage,
  normalizeDeclaredCommands,
} from "../src/toolkit/harness/coverage";
import type { BotSpec } from "../src/toolkit/harness/types";

const bookSpec: BotSpec = {
  name: "booking",
  steps: [
    { send: { text: "/book" }, expect: [{ method: "sendMessage" }] },
    { send: { callback: "slot_14" }, expect: [{ method: "editMessageText" }] },
    { send: { text: "done" }, expect: [{ method: "sendMessage" }] }, // not a command
  ],
};

const cancelSpec: BotSpec = {
  name: "cancel",
  steps: [{ send: { text: "/cancel@mybot extra args" }, expect: [{ method: "sendMessage" }] }],
};

describe("commandsInSpec", () => {
  it("extracts only leading /commands, without slash, CASE PRESERVED", () => {
    expect([...commandsInSpec(bookSpec)]).toEqual(["book"]);
  });
  it("preserves case (grammY routes case-sensitively): /Book stays Book", () => {
    const s: BotSpec = {
      name: "case",
      steps: [{ send: { text: "/Book" }, expect: [{ method: "sendMessage" }] }],
    };
    expect([...commandsInSpec(s)]).toEqual(["Book"]);
  });
  it("strips @botname suffix and arguments", () => {
    expect([...commandsInSpec(cancelSpec)]).toEqual(["cancel"]);
  });
  it("ignores callback and non-command text", () => {
    const s: BotSpec = { name: "x", steps: [{ send: { callback: "y" }, expect: [] }] };
    expect(commandsInSpec(s).size).toBe(0);
  });
  it("does NOT count a command sent with an empty expect[] (review-1 H1)", () => {
    // The send happens but asserts nothing → must not inflate coverage.
    const s: BotSpec = { name: "noop", steps: [{ send: { text: "/book" }, expect: [] }] };
    expect(commandsInSpec(s).size).toBe(0);
  });
});

describe("normalizeDeclaredCommands", () => {
  it("strips slash/@suffix/blanks/dups but PRESERVES case (review-1 L1)", () => {
    // Case is preserved, so Book/book/CANCEL stay distinct. Sort is by UTF-16
    // code unit → uppercase (B,C) sorts before lowercase (b,s).
    expect(normalizeDeclaredCommands(["/Book", "book", "CANCEL@bot", "  ", "start"])).toEqual([
      "Book",
      "CANCEL",
      "book",
      "start",
    ]);
  });
  it("keeps a non-conforming token VERBATIM so it can't escape the gate (review-1 L2)", () => {
    // A weird declared command must still appear (as missing), never be dropped.
    expect(normalizeDeclaredCommands(["/weird-cmd!", "/ok"])).toEqual(["ok", "weird-cmd!"]);
  });
});

describe("computeCoverage", () => {
  it("reports covered + missing vs the declared list", () => {
    const cov = computeCoverage([bookSpec, cancelSpec], ["/book", "/cancel", "/start"]);
    expect(cov.covered.sort()).toEqual(["book", "cancel"]);
    expect(cov.missing).toEqual(["start"]); // declared but no spec
    expect(cov.fraction).toBeCloseTo(2 / 3);
  });

  it("full coverage → fraction 1, no missing", () => {
    const cov = computeCoverage([bookSpec, cancelSpec], ["book", "cancel"]);
    expect(cov.missing).toEqual([]);
    expect(cov.fraction).toBe(1);
  });

  it("no declared commands → fraction 1 (not blocked)", () => {
    const cov = computeCoverage([bookSpec], []);
    expect(cov.fraction).toBe(1);
    expect(cov.missing).toEqual([]);
  });

  it("a command exercised but NOT declared does not inflate coverage", () => {
    // /book is exercised but only /start is declared → still 0 covered.
    const cov = computeCoverage([bookSpec], ["start"]);
    expect(cov.covered).toEqual([]);
    expect(cov.missing).toEqual(["start"]);
    expect(cov.fraction).toBe(0);
  });
});

describe("commandsInSpecs union", () => {
  it("unions commands across specs", () => {
    expect([...commandsInSpecs([bookSpec, cancelSpec])].sort()).toEqual(["book", "cancel"]);
  });
});
