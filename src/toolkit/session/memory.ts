import type { StorageAdapter } from "grammy";

/**
 * In-memory session storage — the toolkit's default persistence adapter.
 *
 * Implements grammY's StorageAdapter so it drops straight into `session({...})`.
 * Suitable for development and for the test harness (deterministic, reset per
 * run). Production bots use Redis (RedisSessionStorage) automatically — createBot
 * auto-selects it when REDIS_URL is set — falling back to this in-memory adapter
 * otherwise. Both expose the same grammY StorageAdapter interface.
 */
export class MemorySessionStorage<T> implements StorageAdapter<T> {
  private store = new Map<string, T>();

  read(key: string): T | undefined {
    return this.store.get(key);
  }

  write(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  readAllKeys(): string[] {
    return [...this.store.keys()];
  }
}
