import type { SecondaryStorage } from "better-auth";
import { getRedis } from "@/lib/redis";

export function redisSecondaryStorage(): SecondaryStorage {
  return {
    async get(key) {
      const redis = await getRedis();
      return redis.get(key);
    },
    async getAndDelete(key) {
      const redis = await getRedis();
      return redis.getdel(key);
    },
    async increment(key, ttl) {
      const redis = await getRedis();
      const next = await redis.incr(key);
      if (next === 1) {
        await redis.expire(key, ttl);
      }
      return next;
    },
    async set(key, value, ttl) {
      const redis = await getRedis();
      if (ttl !== undefined && ttl > 0) {
        await redis.set(key, value, { ex: ttl });
      } else {
        await redis.set(key, value);
      }
    },
    async delete(key) {
      const redis = await getRedis();
      await redis.del(key);
    },
  };
}