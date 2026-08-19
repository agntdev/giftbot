import type { Update } from "grammy/types";

// AGNTDEV test-spec contract. A test = a sequence of incoming Updates and, per
// step, the outgoing Bot API calls expected while handling it. Declarative JSON
// (data, not code) — the Tests stage emits these; the harness replays them
// tokenlessly. See docs/pivot 01-§E, M0-10.

/** A single outgoing Bot API call captured during replay. */
export interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

/** An expected outgoing call. `payload`, if given, is matched as a deep subset
 *  of the actual call's payload (so a spec asserts `text` without pinning
 *  `chat_id`). Omit `payload` to assert only that the method was called. */
export interface ExpectedCall {
  method: string;
  payload?: Record<string, unknown>;
}

/** What the user does in a step: a text message (a `/command` gets a
 *  bot_command entity automatically), a callback-button tap, or a raw Update. */
export type SendShorthand =
  | { text: string; chatId?: number; userId?: number }
  | { callback: string; chatId?: number; userId?: number; messageId?: number }
  | { update: Update };

export interface SpecStep {
  send: SendShorthand;
  expect: ExpectedCall[];
}

export interface BotSpec {
  name: string;
  /**
   * Matching mode. Default (false) = ordered SUBSEQUENCE: every expected call
   * must appear, in order, with a subset payload; incidental extra calls (e.g.
   * answerCallbackQuery) are allowed. true = STRICT: exact count + positional
   * match — use when "and nothing else" matters. The suite-level no-regression
   * guarantee lives in "all existing specs still green", not in per-spec strict.
   */
  strict?: boolean;
  steps: SpecStep[];
}

export interface StepResult {
  ok: boolean;
  captured: CapturedCall[];
  failures: string[];
  /** Set if a handler threw while processing this step (so a red test shows
   *  the reason, not just a call-count diff). */
  error?: string;
}

export interface SpecResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
}
