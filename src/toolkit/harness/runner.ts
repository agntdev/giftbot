import type { Bot, Transformer } from "grammy";
import { HARNESS_BOT_ID, callbackUpdate, textUpdate } from "./updates.js";
import type {
  BotSpec,
  CapturedCall,
  ExpectedCall,
  SendShorthand,
  SpecResult,
  StepResult,
} from "./types.js";

// Tokenless replay: build the bot in-process, set a fake botInfo so grammY never
// calls getMe, install a transformer that CAPTURES every outgoing call and
// returns a stubbed result without hitting the network, then feed synthetic
// Updates via handleUpdate. No real Telegram, no BotFather token.

const fakeBotInfo = {
  id: HARNESS_BOT_ID,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

/** Deep-subset: every key/element of `expected` is present and equal in `actual`. */
function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== "object") return expected === actual;
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => isSubset(e, actual[i]));
  }
  const eo = expected as Record<string, unknown>;
  const ao = actual as Record<string, unknown>;
  return Object.keys(eo).every((k) => isSubset(eo[k], ao[k]));
}

function matchCall(exp: ExpectedCall, actual: CapturedCall): boolean {
  if (exp.method !== actual.method) return false;
  return exp.payload === undefined || isSubset(exp.payload, actual.payload);
}

function describe(e: ExpectedCall): string {
  return e.payload ? `${e.method} ⊇ ${JSON.stringify(e.payload)}` : e.method;
}

function compareStep(expected: ExpectedCall[], captured: CapturedCall[], strict: boolean): string[] {
  const got = captured.map((c) => c.method).join(", ") || "none";
  const failures: string[] = [];

  if (strict) {
    if (captured.length !== expected.length) {
      failures.push(`strict: expected ${expected.length} call(s), got ${captured.length} (${got})`);
      return failures;
    }
    expected.forEach((e, i) => {
      const actual = captured[i];
      if (!actual || !matchCall(e, actual)) {
        failures.push(`call ${i}: expected ${describe(e)}, got ${actual ? `${actual.method} ${JSON.stringify(actual.payload)}` : "nothing"}`);
      }
    });
    return failures;
  }

  // Ordered subsequence: incidental extra calls are allowed.
  let p = 0;
  for (const e of expected) {
    let found = -1;
    for (let i = p; i < captured.length; i++) {
      const c = captured[i];
      if (c && matchCall(e, c)) {
        found = i;
        break;
      }
    }
    if (found < 0) failures.push(`missing expected call ${describe(e)} (got: ${got})`);
    else p = found + 1;
  }
  return failures;
}

function shorthandToUpdate(send: SendShorthand, updateId: number) {
  if ("update" in send) return send.update;
  if ("text" in send) {
    return textUpdate(updateId, send.text, { chatId: send.chatId, userId: send.userId });
  }
  return callbackUpdate(updateId, send.callback, {
    chatId: send.chatId,
    userId: send.userId,
    messageId: send.messageId,
  });
}

/** Flush pending microtasks AND one macrotask turn, so a handler that floated a
 *  promise (didn't await an api call) has that call land before we snapshot. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A plausible deterministic stub for an outgoing call so handlers can chain
 *  (e.g. reply() → editMessageText(returnedMessageId)). */
function stubResult(method: string, payload: Record<string, unknown>, msgId: number): unknown {
  if (/^(send|edit|copy|forward)/.test(method)) {
    return {
      message_id: msgId,
      date: 0,
      chat: { id: (payload.chat_id as number) ?? 1, type: "private" },
      ...(typeof payload.text === "string" ? { text: payload.text } : {}),
    };
  }
  return true;
}

/**
 * Replay a spec against a bot, tokenlessly. Installs a capture transformer and
 * overrides the bot's error handler so handler exceptions surface in the result
 * (instead of being swallowed by the toolkit's bot.catch). Returns per-step
 * pass/fail with captured calls and any thrown error.
 *
 * Call on a FRESH bot per spec (capture state + fake botInfo are per-bot).
 */
export async function runSpec(bot: Bot<any>, spec: BotSpec): Promise<SpecResult> {
  // Tokenless: a fake botInfo means grammY treats the bot as initialized and
  // never issues getMe.
  (bot as unknown as { botInfo: typeof fakeBotInfo }).botInfo = fakeBotInfo;

  const calls: CapturedCall[] = [];
  let stubMsgId = 1000;
  const capture: Transformer = async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    return { ok: true, result: stubResult(method, p, ++stubMsgId) } as unknown as Awaited<
      ReturnType<Transformer>
    >;
  };
  bot.api.config.use(capture);

  // grammY's handleUpdate RETHROWS handler errors (bot.catch only guards the
  // polling/webhook layer), so we trap them here to surface red-test reasons.
  let stepError: unknown;

  const steps: StepResult[] = [];
  let updateId = 0;
  for (const step of spec.steps) {
    updateId++;
    stepError = undefined;
    const before = calls.length;
    try {
      await bot.handleUpdate(shorthandToUpdate(step.send, updateId));
      // Drain the microtask + immediate queues before snapshotting captures. A
      // handler that FLOATS a Bot API call (`void ctx.reply()` — no await) would
      // otherwise resolve during a LATER step and have its call mis-attributed
      // there (or dropped on the last step), making the objective gate flaky and
      // strict-mode counts gameable. One settle pass attributes the floated call
      // to THIS step deterministically.
      await settle();
    } catch (e) {
      stepError = (e as { error?: unknown }).error ?? e;
    }
    const captured = calls.slice(before);
    const failures = compareStep(step.expect, captured, spec.strict ?? false);
    if (stepError !== undefined) failures.unshift(`handler threw: ${String(stepError)}`);
    steps.push({
      ok: failures.length === 0,
      captured,
      failures,
      ...(stepError !== undefined ? { error: String(stepError) } : {}),
    });
  }

  return { name: spec.name, ok: steps.every((s) => s.ok), steps };
}
