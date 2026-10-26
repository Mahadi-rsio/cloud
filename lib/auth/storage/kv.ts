import type { SecondaryStorage } from "better-auth";

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

class InMemoryKv implements KvLike {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

let cachedKv: KvLike | undefined;

export async function getKvBinding(): Promise<KvLike> {
  if (cachedKv) return cachedKv;
  try {
    const { env } = await import("cloudflare:workers");
    cachedKv = env.AUTH_KV;
  } catch {
    cachedKv = new InMemoryKv();
  }
  return cachedKv;
}

export function kvSecondaryStorage(): SecondaryStorage {
  return {
    async get(key) {
      const kv = await getKvBinding();
      return kv.get(key);
    },
    async getAndDelete(key) {
      const kv = await getKvBinding();
      const value = await kv.get(key);
      if (value !== null) {
        await kv.delete(key);
      }
      return value;
    },
    async increment(key, ttl) {
      const kv = await getKvBinding();
      const raw = await kv.get(key);
      const next = (raw ? parseInt(raw, 10) : 0) + 1;
      await kv.put(key, String(next), { expirationTtl: ttl });
      return next;
    },
    async set(key, value, ttl) {
      const kv = await getKvBinding();
      if (ttl !== undefined && ttl > 0) {
        await kv.put(key, value, { expirationTtl: ttl });
      } else {
        await kv.put(key, value);
      }
    },
    async delete(key) {
      const kv = await getKvBinding();
      await kv.delete(key);
    },
  };
}