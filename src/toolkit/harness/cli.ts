#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import type { Bot } from "grammy";
import { runSpecs } from "./run-specs.js";
import { parseBotSpecs } from "./run-specs.js";
import { computeCoverage } from "./coverage.js";
import type { BotSpec, SpecResult } from "./types.js";

// AGNTDEV Tests-gate CLI (see docs/pivot/04 §4 + 09 step 3). Builds the bot from
// the generated project, replays every dialog spec tokenlessly via the harness,
// computes command-coverage vs the Details-declared command list, and emits ONE
// machine-readable JSON line on stdout: the Tests-gate verdict the Go side
// parses (builder_test_gate.go).
//
// Inputs (env, so the sandbox wrapper sets them without arg parsing):
//   AGNTDEV_BOT_MODULE   — path to the bot module exporting `makeBot(): Bot`
//                          (a fresh bot per call; the harness needs isolation).
//   AGNTDEV_SPECS_FILE   — path to a JSON file: an array of BotSpec.
//   AGNTDEV_COMMANDS_FILE— path to a JSON file: string[] of declared commands.
//                          Optional; absent → coverage fraction = 1.
//
// Output (stdout, single line):
//   GATE:{"ok":bool,"total":N,"passed":N,"failed":N,
//         "coverage":{...},"results":[{name,ok}...]}
// Logs go to stderr. Exit 0 on a clean run regardless of gate pass/fail (the
// VERDICT is in the JSON; a nonzero exit means the runner itself broke).

// The verdict line is authenticated with a per-run nonce the caller passes via
// AGNTDEV_GATE_NONCE: "GATE:<nonce>:{...}". Untrusted bot code shares this stdout
// and could print a forged "GATE:..." line, so the Go side (ParseTestGateResult)
// only accepts the line carrying the nonce it generated (review-1 H2).
const MARKER = "GATE:";
const gateNonce = process.env.AGNTDEV_GATE_NONCE ?? "";
function emitGate(verdict: unknown): void {
  process.stdout.write(MARKER + gateNonce + ":" + JSON.stringify(verdict) + "\n");
}

interface BotModule {
  makeBot?: () => Bot<any> | Promise<Bot<any>>;
  default?: () => Bot<any> | Promise<Bot<any>>;
}

function log(...a: unknown[]) {
  // eslint-disable-next-line no-console
  console.error("[agntdev-test-gate]", ...a);
}

async function loadJSON(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

/** Resolve the bot factory from a module that exports `makeBot` or a default fn. */
function resolveMakeBot(mod: BotModule): () => Bot<any> | Promise<Bot<any>> {
  const fn = mod.makeBot ?? mod.default;
  if (typeof fn !== "function") {
    throw new Error("bot module must export makeBot() (or a default factory function)");
  }
  return fn;
}

async function main(): Promise<void> {
  const botModulePath = process.env.AGNTDEV_BOT_MODULE;
  const specsFile = process.env.AGNTDEV_SPECS_FILE;
  const commandsFile = process.env.AGNTDEV_COMMANDS_FILE;

  if (!botModulePath || !specsFile) {
    throw new Error("AGNTDEV_BOT_MODULE and AGNTDEV_SPECS_FILE are required");
  }

  const specs: BotSpec[] = parseBotSpecs(await loadJSON(specsFile));
  let declared: string[] = [];
  if (commandsFile) {
    const c = await loadJSON(commandsFile);
    if (Array.isArray(c)) declared = c as string[];
  }

  const mod = (await import(botModulePath)) as BotModule;
  const makeBot = resolveMakeBot(mod);

  log(`running ${specs.length} spec(s), ${declared.length} declared command(s)`);
  const suite = await runSpecs(makeBot, specs);
  const coverage = computeCoverage(specs, declared);

  const allGreen = suite.failed === 0 && suite.total > 0;
  const coverageOK = coverage.missing.length === 0;
  const ok = allGreen && coverageOK;

  const verdict = {
    ok,
    total: suite.total,
    passed: suite.passed,
    failed: suite.failed,
    coverage,
    results: suite.results.map((r: SpecResult) => ({ name: r.name, ok: r.ok })),
  };
  emitGate(verdict);
}

main()
  .then(() => {
    // The verdict is already emitted on stdout. Force-exit so the bot's dangling
    // handles — a daily-cron setInterval, an open Postgres pool, a Redis socket —
    // can't keep node's event loop alive until the CI runner's hard timeout
    // SIGKILLs the container (which would discard the verdict + churn the gate).
    process.exit(0);
  })
  .catch((err) => {
  log("FATAL:", err instanceof Error ? err.message : String(err));
  // Emit a failed-gate verdict so a runner crash is unambiguously NOT a pass.
  emitGate({
    ok: false,
    total: 0,
    passed: 0,
    failed: 0,
    coverage: { declared: [], covered: [], missing: [], fraction: 0 },
    results: [],
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(0); // the verdict is in the JSON; reserve nonzero for harness bugs
});
