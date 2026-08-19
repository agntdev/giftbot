import type { StorageAdapter } from "grammy";
import { MemorySessionStorage } from "./memory.js";

/**
 * Redis session storage for production bots (Change 3 / docs/pivot open
 * question 2.8). Auto-selected by createBot when REDIS_URL is set, so generated
 * bots persist session state in Redis with ZERO code changes (and fall back to
 * in-memory otherwise). State is recyclable — losing Redis loses sessions, not
 * the bot.
 */

/**
 * The minimal ioredis surface RedisSessionStorage needs. Keeping it an
 * interface lets us unit-test the adapter with a fake in-memory client (no
 * server, no ioredis dependency in the test).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * A grammY StorageAdapter backed by Redis. Values are JSON-serialized and
 * stored under a key prefix so a shared Redis (should one ever be used) is
 * namespaced. Async throughout — grammY's StorageAdapter accepts MaybePromise.
 */
export class RedisSessionStorage<T> implements StorageAdapter<T> {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = "sess:",
  ) {}

  private k(key: string): string {
    return this.prefix + key;
  }

  async read(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.k(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt/non-JSON value is treated as absent (recyclable state).
      return undefined;
    }
  }

  async write(key: string, value: T): Promise<void> {
    await this.client.set(this.k(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }

  async has(key: string): Promise<boolean> {
    return (await this.read(key)) !== undefined;
  }

  async *readAllKeys(): AsyncIterableIterator<string> {
    const keys = await this.client.keys(this.prefix + "*");
    for (const k of keys) yield k.slice(this.prefix.length);
  }
}

/**
 * Factory that builds a RedisSessionStorage from a connection URL using a real
 * ioredis client. node:module + ioredis are loaded on the FIRST session
 * operation, not at import: this module rides into the Workers bundle (via
 * toolkit/index) and Cloudflare rejects any STATIC node:* import at upload —
 * a dynamic import inside a function that only ever runs under Node is fine.
 * The client connects in the background; reads/writes resolve once connected.
 */
export function defaultRedisStorage<T>(url: string): StorageAdapter<T> {
  let inner: Promise<RedisSessionStorage<T>> | null = null;
  const get = (): Promise<RedisSessionStorage<T>> =>
    (inner ??= (async () => {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis: any = require("ioredis");
      const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
      // maxRetriesPerRequest: null → commands queue while (re)connecting rather
      // than failing fast, matching session-store expectations.
      const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
      return new RedisSessionStorage<T>(client as RedisLike);
    })());
  return {
    read: async (key) => (await get()).read(key),
    write: async (key, value) => {
      await (await get()).write(key, value);
    },
    delete: async (key) => {
      await (await get()).delete(key);
    },
    has: async (key) => (await get()).has(key),
  };
}

/**
 * resolveSessionStorage picks the session storage for createBot:
 *   1. an explicitly-passed adapter wins;
 *   2. else, when env.REDIS_URL is set, build Redis storage (via `make`);
 *   3. else in-memory (development / no Redis configured).
 *
 * `env` and `make` are injectable for testing (default: process.env when it
 * exists — on Cloudflare Workers there is no `process`, so the default is {}
 * and the explicit adapter the Workers entry always passes wins). Always
 * returns a concrete adapter — the single source of truth for createBot's
 * storage choice.
 */
export function resolveSessionStorage<S extends object>(
  explicit: StorageAdapter<S> | undefined,
  env: { REDIS_URL?: string } = typeof process === "undefined" ? {} : process.env,
  make: (url: string) => StorageAdapter<S> = defaultRedisStorage,
): StorageAdapter<S> {
  if (explicit) return explicit;
  if (env.REDIS_URL) return make(env.REDIS_URL);
  return new MemorySessionStorage<S>();
}
