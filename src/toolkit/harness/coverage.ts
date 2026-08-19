import type { BotSpec, SendShorthand, SpecStep } from "./types.js";

// AGNTDEV Tests-gate command coverage (see docs/pivot/04 §4). The objective
// gate is "all specs green AND every command in the Details state-machine has
// >= 1 spec MEANINGFULLY exercising it". This file computes the command-coverage
// half: which declared commands are tested by the spec suite, and which aren't.
//
// Pure functions over the parsed specs + the declared command list — no FS, no
// bot — so they unit-test deterministically. The CLI wires FS + the harness run
// around them.
//
// CASE/CHARSET (review-1 L1/L2): grammY's command router is CASE-SENSITIVE and
// Telegram commands are [a-z0-9_]. We DO NOT lowercase — "/Book" and "/book" are
// different commands, so coverage must distinguish them (lowercasing both made a
// case-mismatched command look covered when the real bot wouldn't route it).
// Command tokens that don't match the Telegram charset are kept verbatim (not
// silently dropped), so a declared command can never escape the requirement.

/** A leading "/command" extracted from a send step, WITHOUT the slash and any
 *  @botusername suffix or arguments. Case preserved. Returns null for a non-
 *  command text, a callback, or a raw-update send. */
function commandOfSend(send: SendShorthand): string | null {
  if (!("text" in send) || typeof send.text !== "string") return null;
  const m = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?/.exec(send.text.trim());
  return m ? m[1]! : null;
}

/** Whether a step is a MEANINGFUL assertion: it expects >= 1 outgoing Bot API
 *  call. A step with an empty expect[] asserts nothing about the bot's behavior
 *  (it is trivially green regardless of what the handler does), so it must NOT
 *  count toward coverage — otherwise an agent gets full coverage by merely
 *  SENDING every command with no assertions (review-1 H1). */
function stepIsMeaningful(step: SpecStep): boolean {
  return Array.isArray(step.expect) && step.expect.length > 0;
}

/** The set of commands a single spec MEANINGFULLY exercises: a command counts
 *  only if the step that sends it also asserts at least one expected call. */
export function commandsInSpec(spec: BotSpec): Set<string> {
  const out = new Set<string>();
  for (const step of spec.steps) {
    if (!stepIsMeaningful(step)) continue;
    const c = commandOfSend(step.send);
    if (c) out.add(c);
  }
  return out;
}

/** The union of commands exercised across a whole suite. */
export function commandsInSpecs(specs: BotSpec[]): Set<string> {
  const out = new Set<string>();
  for (const s of specs) for (const c of commandsInSpec(s)) out.add(c);
  return out;
}

export interface CoverageReport {
  /** Declared commands (from Details), normalized without slash. Case PRESERVED
   *  (grammY routes case-sensitively). */
  declared: string[];
  /** Declared commands with >= 1 MEANINGFUL spec exercising them. */
  covered: string[];
  /** Declared commands with NO meaningful spec — these fail the gate. */
  missing: string[];
  /** covered / declared as a 0..1 fraction (1 when nothing is declared). */
  fraction: number;
}

/** Normalize a declared command list: strip a leading slash + any @suffix, trim,
 *  drop blanks, dedup. Case is PRESERVED (review-1 L1). A token that doesn't fit
 *  the Telegram charset is kept VERBATIM (review-1 L2) rather than dropped, so a
 *  weird declared command can't silently escape the coverage requirement — it
 *  stays in `declared`, will never be matched by a spec, and shows up as missing. */
export function normalizeDeclaredCommands(declared: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of declared) {
    if (typeof raw !== "string") continue;
    let s = raw.trim();
    if (s === "") continue;
    if (s.startsWith("/")) s = s.slice(1);
    // Strip a trailing @botname if present; keep everything else verbatim.
    const at = s.indexOf("@");
    if (at >= 0) s = s.slice(0, at);
    if (s !== "") seen.add(s);
  }
  return [...seen].sort();
}

/**
 * computeCoverage compares the commands exercised by the spec suite against the
 * declared command list. A command is "covered" iff at least one spec sends it.
 * fraction is covered/declared (1.0 when nothing is declared, so a command-less
 * bot is not blocked by this half of the gate).
 */
export function computeCoverage(specs: BotSpec[], declared: string[]): CoverageReport {
  const decl = normalizeDeclaredCommands(declared);
  const exercised = commandsInSpecs(specs);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const c of decl) (exercised.has(c) ? covered : missing).push(c);
  const fraction = decl.length === 0 ? 1 : covered.length / decl.length;
  return { declared: decl, covered, missing, fraction };
}
