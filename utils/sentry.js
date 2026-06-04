"use strict";
/**
 * Optional error tracking (Sentry).
 *
 * Fully no-op unless BOTH SENTRY_DSN is set AND @sentry/node is installed — so
 * it can never break startup. Errors are reported MANUALLY (from the Express
 * error handler + the process crash guards) rather than via auto-instrumentation,
 * which is version-tolerant and avoids import-ordering requirements.
 *
 * Enable in production:
 *   1) npm install @sentry/node
 *   2) set SENTRY_DSN in the environment (see .env.example)
 */
let Sentry = null;
let enabled = false;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[sentry] SENTRY_DSN not set — error tracking disabled");
    return;
  }
  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 0, // errors only — no performance-tracing overhead
      sendDefaultPii: false,
    });
    enabled = true;
    console.log("[sentry] error tracking enabled");
  } catch (e) {
    console.warn("[sentry] disabled — run `npm install @sentry/node` to enable:", e.message);
  }
}

/** Report an error with optional request/tenant context tags. Best-effort. */
function captureException(err, context = {}) {
  if (!enabled || !Sentry) return;
  try {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag("requestId", context.requestId);
      if (context.clubId) scope.setTag("clubId", String(context.clubId));
      if (context.method) scope.setTag("http.method", context.method);
      if (context.kind) scope.setTag("kind", context.kind);
      if (context.url) scope.setExtra("url", context.url);
      if (context.userId) scope.setUser({ id: String(context.userId) });
      Sentry.captureException(err);
    });
  } catch (_) {
    /* never let error reporting throw */
  }
}

/** Flush buffered events (call before a graceful shutdown). Best-effort. */
async function flush(timeoutMs = 2000) {
  if (!enabled || !Sentry || typeof Sentry.flush !== "function") return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (_) {}
}

module.exports = { initSentry, captureException, flush, isEnabled: () => enabled };
