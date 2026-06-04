/**
 * PM2 process-management config for the Chalo Khelne API.
 *
 *   Production:  pm2 start ecosystem.config.js --env production
 *   Local:       pm2 start ecosystem.config.js
 *   Reload:      pm2 reload chalo-khelne-api
 *
 * CURRENT (single-instance, default & safe): one fork-mode web process that also
 * runs the cron jobs in-process. Correct as long as there is exactly ONE web
 * instance.
 *
 * GOING MULTI-INSTANCE (Phase 2 HA) — the building blocks now exist:
 *   • Redis Socket.io adapter (utils/socketAdapter.js, gated on REDIS_URL)
 *   • Dedicated cron worker (worker.js), gated by RUN_CRON
 * To flip, do ALL of the following together:
 *   1) Provision Redis and set REDIS_URL (enables cross-instance sockets +
 *      rate limits) and `npm install @socket.io/redis-adapter`.
 *   2) Set the web app to cluster mode with RUN_CRON=false, e.g.:
 *        instances: "max", exec_mode: "cluster", env: { RUN_CRON: "false" }
 *   3) Add the cron worker app below (uncomment) so jobs fire in exactly ONE
 *      process. Run web with sticky sessions at the load balancer for sockets.
 * Do NOT enable cluster mode without steps 1+3, or crons double-fire and socket
 * rooms break across workers.
 */
module.exports = {
  apps: [
    {
      name: "chalo-khelne-api",
      script: "server.js",
      instances: 1, // → "max" + exec_mode:"cluster" + env RUN_CRON:"false" when going multi-instance
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      // Give our graceful shutdown (30s drain safety net in server.js) time to
      // finish before PM2 force-kills the process.
      kill_timeout: 35000,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        // RUN_CRON: "false",   // ← uncomment when running the dedicated worker below
      },
    },

    // ── Dedicated cron worker (Phase 2 HA) ──
    // Keep COMMENTED while single-instance (the web process runs cron). When
    // going multi-instance, set RUN_CRON=false on the web app above and
    // uncomment this so the scheduled jobs run in exactly ONE process.
    // {
    //   name: "chalo-khelne-worker",
    //   script: "worker.js",
    //   instances: 1,          // MUST be exactly 1 — never cluster the worker
    //   exec_mode: "fork",
    //   autorestart: true,
    //   max_memory_restart: "256M",
    //   kill_timeout: 20000,
    //   env: { NODE_ENV: "development" },
    //   env_production: { NODE_ENV: "production" },
    // },
  ],
};
