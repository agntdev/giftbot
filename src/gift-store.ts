import type { Ctx } from "./bot.js";
import { now } from "./clock.js";

export interface Gift { gift_name: string; emoji: string }
export interface Participant { user_id: number; username?: string; first_name: string; last_seen: number }
export interface GiveawayEvent { timestamp: number; winner_id: number; gift: Gift; trigger: "manual" | "automatic" }
export interface GiveawaySettings {
  locale: "ru";
  activeWindowMinutes: number;
  repeatProtection: number;
  intervalMinMinutes: number;
  intervalMaxMinutes: number;
  mentionFormat: "username" | "name";
  automaticEnabled: boolean;
  /** Node/Fly fallback: an activity update runs a due giveaway when no DO alarm exists. */
  nextAutomaticAt?: number;
}
export interface GiftState { participants: Participant[]; gifts: Gift[]; events: GiveawayEvent[]; settings: GiveawaySettings }

/** The owner-selected prize: every giveaway awards the bear. */
export const DEFAULT_GIFTS: readonly Gift[] = [{ gift_name: "мишка", emoji: "🧸" }];

export function defaultGiftState(): GiftState {
  return { participants: [], gifts: DEFAULT_GIFTS.map((gift) => ({ ...gift })), events: [], settings: { locale: "ru",
    activeWindowMinutes: 30, repeatProtection: 2, intervalMinMinutes: 1,
    intervalMaxMinutes: 90, mentionFormat: "username", automaticEnabled: false,
  }};
}

type GiftDO = { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> };
type WorkerLike = { env?: { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): GiftDO } } };

function chatKey(ctx: Ctx): string { return String(ctx.chat?.id ?? ctx.from?.id ?? "unknown"); }

async function workerState(ctx: Ctx & WorkerLike, next?: GiftState): Promise<GiftState | undefined> {
  const ns = ctx.env?.CHAT_DO;
  if (!ns) return undefined;
  const stub = ns.get(ns.idFromName(`chat:${chatKey(ctx)}`));
  if (next) {
    await stub.fetch(`https://do/gift-state?chat=${encodeURIComponent(chatKey(ctx))}`, { method: "PUT", body: JSON.stringify(next) });
    return next;
  }
  const response = await stub.fetch("https://do/gift-state", { method: "GET" });
  return response.status === 204 ? undefined : await response.json() as GiftState;
}

async function redisState(ctx: Ctx, next?: GiftState): Promise<GiftState | undefined> {
  if (typeof process === "undefined" || !process.env.REDIS_URL) return undefined;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // ioredis is deliberately loaded only on Node. Workers use the ChatDO path above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = require("ioredis");
  const Redis = mod.default ?? mod.Redis ?? mod;
  const client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  const key = `giftgiver:${chatKey(ctx)}`;
  try {
    if (next) { await client.set(key, JSON.stringify(next)); return next; }
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) as GiftState : undefined;
  } finally { client.disconnect(); }
}

/** Per-chat durable record. Production stores use a Worker Durable Object or Redis. */
export async function readGiftState(ctx: Ctx): Promise<GiftState> {
  const state = await workerState(ctx as Ctx & WorkerLike) ?? await redisState(ctx) ?? (ctx.session.giftState as GiftState | undefined);
  if (!state) return defaultGiftState();
  state.settings.locale = "ru";
  // Existing chats may have an older multi-gift pool. The owner now offers only
  // the bear, so normalize the durable record before every giveaway as well.
  state.gifts = DEFAULT_GIFTS.map((gift) => ({ ...gift }));
  state.settings.intervalMinMinutes = Math.min(90, Math.max(1, state.settings.intervalMinMinutes));
  state.settings.intervalMaxMinutes = Math.min(90, Math.max(state.settings.intervalMinMinutes, state.settings.intervalMaxMinutes));
  return state;
}
export async function writeGiftState(ctx: Ctx, state: GiftState): Promise<void> {
  if (await workerState(ctx as Ctx & WorkerLike, state)) return;
  if (await redisState(ctx, state)) return;
  ctx.session.giftState = state;
}

export async function trackParticipant(ctx: Ctx): Promise<void> {
  if (!ctx.from || ctx.from.is_bot) return;
  const state = await readGiftState(ctx);
  const participant: Participant = { user_id: ctx.from.id, username: ctx.from.username, first_name: ctx.from.first_name || "друг", last_seen: now() };
  const index = state.participants.findIndex((item) => item.user_id === participant.user_id);
  if (index >= 0) state.participants[index] = participant;
  else state.participants.push(participant);
  await writeGiftState(ctx, state);
}

export type GiveawayResult = { kind: "winner"; participant: Participant; gift: Gift } | { kind: "empty-gifts" | "no-active" | "recent-winners" };

function randomIndex(length: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % length;
}

export async function runGiveaway(ctx: Ctx, trigger: "manual" | "automatic"): Promise<GiveawayResult> {
  const state = await readGiftState(ctx);
  if (state.gifts.length === 0) return { kind: "empty-gifts" };
  const cutoff = now() - state.settings.activeWindowMinutes * 60_000;
  const active = state.participants.filter((person) => person.last_seen >= cutoff);
  if (active.length === 0) return { kind: "no-active" };
  const blocked = new Set(state.events.slice(-state.settings.repeatProtection).map((event) => event.winner_id));
  const eligible = active.filter((person) => !blocked.has(person.user_id));
  if (eligible.length === 0) return { kind: "recent-winners" };
  const participant = eligible[randomIndex(eligible.length)];
  const gift = state.gifts[randomIndex(state.gifts.length)];
  state.events.push({ timestamp: now(), winner_id: participant.user_id, gift, trigger });
  // Keep a bounded history while retaining enough events for repeat protection and owner context.
  if (state.events.length > 100) state.events.splice(0, state.events.length - 100);
  await writeGiftState(ctx, state);
  return { kind: "winner", participant, gift };
}

function automaticDelayMs(settings: GiveawaySettings): number {
  const min = Math.min(90, Math.max(1, settings.intervalMinMinutes));
  const max = Math.min(90, Math.max(min, settings.intervalMaxMinutes));
  return (min + randomIndex(max - min + 1)) * 60_000;
}

/**
 * Fly has no Durable Object alarm. When chat activity arrives, it advances any
 * due automatic giveaway from the durable per-chat record. Workers use their
 * exact DO alarm instead, so the two schedulers cannot announce the same draw.
 */
export async function runDueAutomaticGiveaway(ctx: Ctx): Promise<GiveawayResult | undefined> {
  if ((ctx as Ctx & { env?: unknown }).env) return undefined;
  const state = await readGiftState(ctx);
  if (!state.settings.automaticEnabled) return undefined;
  const current = now();
  if (!state.settings.nextAutomaticAt) {
    state.settings.nextAutomaticAt = current + automaticDelayMs(state.settings);
    await writeGiftState(ctx, state);
    return undefined;
  }
  if (state.settings.nextAutomaticAt > current) return undefined;
  const result = await runGiveaway(ctx, "automatic");
  const updated = await readGiftState(ctx);
  updated.settings.nextAutomaticAt = current + automaticDelayMs(updated.settings);
  await writeGiftState(ctx, updated);
  return result;
}

export function scheduleNextAutomaticGiveaway(state: GiftState): void {
  state.settings.nextAutomaticAt = now() + automaticDelayMs(state.settings);
}
