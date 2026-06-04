/**
 * Dedicated background worker — owns the scheduled cron jobs so the web tier can
 * scale to multiple instances without double-firing them.
 *
 * Single-instance (default): you do NOT need this — the web process runs the
 *   crons (RUN_CRON unset/true).
 * Multi-instance (Phase 2 HA): start web instances with RUN_CRON=false, and run
 *   exactly ONE worker so each job fires once:
 *     pm2 start worker.js --name chalo-khelne-worker -i 1
 *   (or via ecosystem.config.js — see the commented worker app there)
 *
 * This process does NOT open an HTTP server or sockets — it only runs cron.
 */
require("dotenv").config();

const { validateEnv } = require("./Config/validateEnv");
validateEnv();

const { patchConsole } = require("./utils/logger");
patchConsole();

const { initSentry, captureException } = require("./utils/sentry");
initSentry();

const mongoose = require("mongoose");
const { startAllCrons } = require("./cron/startCrons");

mongoose.connection.on("error", (err) => console.error("[worker][MONGO] runtime error:", err.message));
mongoose.connection.on("disconnected", () => console.warn("[worker][MONGO] disconnected"));
mongoose.connection.on("reconnected", () => console.log("[worker][MONGO] reconnected"));

mongoose
  .connect(process.env.MONGO_URI, {
    maxPoolSize: 10, // smaller pool than the web tier — this process only runs jobs
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log("[worker] MongoDB connected");
    startAllCrons();
    console.log("[worker] cron worker running");
  })
  .catch((err) => {
    console.error("[worker] FATAL: MongoDB connection failed:", err.message);
    process.exit(1);
  });

// ── Graceful shutdown ──
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal} — closing...`);
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();
  mongoose.connection
    .close(false)
    .then(() => { console.log("[worker] mongo closed. bye."); clearTimeout(forceExit); process.exit(0); })
    .catch(() => process.exit(1));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[worker][FATAL] Unhandled promise rejection:", reason);
  captureException(reason instanceof Error ? reason : new Error("Unhandled rejection: " + String(reason)), { kind: "worker.unhandledRejection" });
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  console.error("[worker][FATAL] Uncaught exception:", err);
  captureException(err, { kind: "worker.uncaughtException" });
  shutdown("uncaughtException");
});
