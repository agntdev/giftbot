import { describe, expect, it } from "vitest";
import {
  RedisSessionStorage,
  resolveSessionStorage,
  type RedisLike,
} from "../src/toolkit/session/redis";
import { MemorySessionStorage } from "../src/toolkit/session/memory";

// A fake ioredis-shaped client: an in-memory map with the get/set/del/keys
// surface RedisSessionStorage uses. Lets us test the adapter with no server.
function fakeClient(): RedisLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.has(k) ? store.get(k)! : null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    async del(k) {
      store.delete(k);
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, "");
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

describe("RedisSessionStorage", () => {
  it("round-trips JSON values through the client under a prefix", async () => {
    const c = fakeClient();
    const s = new RedisSessionStorage<{ n: number }>(c, "sess:");
    expect(await s.read("u1")).toBeUndefined();
    await s.write("u1", { n: 5 });
    expect(c.store.has("sess:u1")).toBe(true); // prefixed key in redis
    expect(await s.read("u1")).toEqual({ n: 5 });
    expect(await s.has("u1")).toBe(true);
    await s.delete("u1");
    expect(await s.read("u1")).toBeUndefined();
  });

  it("lists keys with the prefix stripped", async () => {
    const c = fakeClient();
    const s = new RedisSessionStorage<number>(c, "sess:");
    await s.write("a", 1);
    await s.write("b", 2);
    const out: string[] = [];
    for await (const k of s.readAllKeys()) out.push(k);
    expect(out.sort()).toEqual(["a", "b"]);
  });
});

type Sess = { n: number };

describe("resolveSessionStorage (auto-select)", () => {
  it("uses an explicit storage when provided", () => {
    const explicit = new MemorySessionStorage<Sess>();
    const got = resolveSessionStorage<Sess>(explicit, {}, () => {
      throw new Error("factory must not be called");
    });
    expect(got).toBe(explicit);
  });

  it("falls back to in-memory when REDIS_URL is absent", () => {
    let made = false;
    const got = resolveSessionStorage<Sess>(undefined, {}, () => {
      made = true;
      return new MemorySessionStorage<Sess>();
    });
    expect(made).toBe(false);
    expect(got).toBeInstanceOf(MemorySessionStorage);
  });

  it("builds Redis storage from REDIS_URL when present", () => {
    let url = "";
    const redisStore = new RedisSessionStorage<Sess>(fakeClient());
    const got = resolveSessionStorage<Sess>(undefined, { REDIS_URL: "redis://r:6379" }, (u) => {
      url = u;
      return redisStore;
    });
    expect(url).toBe("redis://r:6379");
    expect(got).toBe(redisStore);
  });
});
