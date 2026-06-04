/**
 * Rate-limit store factory.
 *
 * Returns a Redis-backed store (shared across all app instances) when REDIS_URL
 * is set, otherwise `undefined` so express-rate-limit uses its default in-memory
 * store (single-process only — fine for dev / single-instance). This makes
 * multi-instance deploys enforce limits globally without a hard Redis dependency.
 *
 * Each limiter MUST pass a unique prefix so their counters don't collide in Redis.
 */
const REDIS_URL = process.env.REDIS_URL;
let client = null;

if (REDIS_URL) {
  try {
    const Redis = require("ioredis");
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Never let a Redis outage crash the process — log and let limiters degrade.
    client.on("error", (e) => console.error("[rate-limit] Redis error:", e.message));
    client.on("connect", () => console.log("[rate-limit] Redis connected for rate limiting"));
  } catch (e) {
    console.error("[rate-limit] Redis init failed — falling back to in-memory store:", e.message);
    client = null;
  }
}

function rateLimitStore(prefix) {
  if (!client) return undefined; // express-rate-limit → default MemoryStore
  try {
    const { RedisStore } = require("rate-limit-redis");
    return new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: prefix || "rl:",
    });
  } catch (e) {
    console.error("[rate-limit] RedisStore init failed — using in-memory store:", e.message);
    return undefined;
  }
}

module.exports = rateLimitStore;
