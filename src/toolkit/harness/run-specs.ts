import type { Bot } from "grammy";
import { runSpec } from "./runner.js";
import type { BotSpec, SpecResult } from "./types.js";

// Suite runner + reporting + spec validation — the executable form of the
// self-test gate. The codegen self-test (M0-6) and the auto-verification CI
// (M1-6) both: load JSON specs (parseBotSpec), run them against a fresh bot
// per spec (runSpecs), and gate on the aggregate (formatSuiteResult / failed).

export interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  results: SpecResult[];
}

/**
 * Run many specs, each against a FRESH bot from `makeBot` (isolation — capture
 * state and the fake botInfo are per-bot). Returns the aggregate.
 */
export async function runSpecs(makeBot: () => Bot<any> | Promise<Bot<any>>, specs: BotSpec[]): Promise<SuiteResult> {
  const results: SpecResult[] = [];
  for (const spec of specs) {
    results.push(await runSpec(await makeBot(), spec));
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

/** A concise human/CI-readable report. */
export function formatSuiteResult(suite: SuiteResult): string {
  const header = `${suite.passed}/${suite.total} specs passed${
    suite.failed > 0 ? ` (${suite.failed} failed)` : ""
  }`;
  const lines = [header];
  for (const r of suite.results) {
    lines.push(`${r.ok ? "✓" : "✗"} ${r.name}`);
    if (!r.ok) {
      r.steps.forEach((st, i) => {
        if (!st.ok) lines.push(`    step ${i + 1}: ${st.failures.join("; ")}`);
      });
    }
  }
  return lines.join("\n");
}

/** Validate + narrow an untrusted JSON value into a BotSpec. Throws on malformed
 *  input (generated specs are not blindly trusted). */
export function parseBotSpec(obj: unknown): BotSpec {
  if (typeof obj !== "object" || obj === null) throw new Error("spec must be an object");
  const o = obj as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name === "") {
    throw new Error("spec.name must be a non-empty string");
  }
  if (!Array.isArray(o.steps)) throw new Error("spec.steps must be an array");
  o.steps.forEach((step, i) => {
    if (typeof step !== "object" || step === null) throw new Error(`step ${i} must be an object`);
    const s = step as Record<string, unknown>;
    if (typeof s.send !== "object" || s.send === null) throw new Error(`step ${i} missing 'send'`);
    if (!Array.isArray(s.expect)) throw new Error(`step ${i} 'expect' must be an array`);
  });
  return obj as BotSpec;
}

/** Validate an array of specs (e.g. a parsed specs.json). */
export function parseBotSpecs(arr: unknown): BotSpec[] {
  if (!Array.isArray(arr)) throw new Error("specs must be an array");
  return arr.map(parseBotSpec);
}
