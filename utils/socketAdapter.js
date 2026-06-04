"use strict";
/**
 * Optional Redis adapter for Socket.io (Phase 2 — horizontal scaling).
 *
 * With multiple API instances, Socket.io's default in-memory adapter can't fan
 * out events across processes (a live score emitted on instance A wouldn't reach
 * a client connected to instance B). The Redis adapter shares rooms/events via a
 * Redis pub/sub channel so all instances stay in sync.
 *
 * Fully no-op fallback to the in-memory adapter unless REDIS_URL is set AND the
 * deps are installed — so single-instance dev/prod is completely unchanged and
 * startup can never break.
 *
 * Enable for multi-instance:
 *   npm install @socket.io/redis-adapter      # ioredis is already a dependency
 *   set REDIS_URL   (the same one used for rate limiting)
 */
let clients = [];

function attachRedisAdapter(io) {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("[socket] REDIS_URL not set — in-memory adapter (single-instance only)");
    return false;
  }
  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const Redis = require("ioredis");
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    // Surface connection issues without crashing the server.
    pubClient.on("error", (e) => console.error("[socket][redis pub]", e.message));
    subClient.on("error", (e) => console.error("[socket][redis sub]", e.message));
    io.adapter(createAdapter(pubClient, subClient));
    clients = [pubClient, subClient];
    console.log("[socket] Redis adapter attached — multi-instance ready");
    return true;
  } catch (e) {
    console.warn("[socket] Redis adapter unavailable — falling back to in-memory:", e.message);
    return false;
  }
}

function closeRedisAdapter() {
  for (const c of clients) {
    try { c.disconnect(); } catch (_) {}
  }
  clients = [];
}

module.exports = { attachRedisAdapter, closeRedisAdapter };
