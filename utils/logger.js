/**
 * Centralized winston logger.
 *
 * Levels: error < warn < info < debug (npm levels). Default level is `debug`
 * in development and `info` in production; override with LOG_LEVEL.
 *
 * Rather than hand-editing ~1,300 existing console.* calls across the codebase,
 * patchConsole() routes them through winston:
 *   console.error → logger.error
 *   console.warn  → logger.warn
 *   console.log/info → logger.info
 *   console.debug → logger.debug
 * so every existing log line gets a level + timestamp (+ JSON in prod) for free.
 * New code can `require("./utils/logger").logger` and call levels directly.
 */
"use strict";

const winston = require("winston");

const isProd = process.env.NODE_ENV === "production";

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, stack }) =>
    `${timestamp} ${level}: ${stack || message}`
  )
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  levels: winston.config.npm.levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    isProd ? winston.format.json() : devFormat
  ),
  transports: [new winston.transports.Console()],
  // winston writes to process.stdout/stderr directly (NOT via console), so
  // patchConsole() below cannot create a recursive loop.
});

// Safely stringify a console argument (handles Errors + circular objects).
function fmtArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === "object" && a !== null) {
    try {
      return JSON.stringify(a);
    } catch (_) {
      return "[unserializable object]";
    }
  }
  return String(a);
}

let consolePatched = false;
function patchConsole() {
  if (consolePatched) return;
  consolePatched = true;
  const map = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug" };
  for (const [method, level] of Object.entries(map)) {
    console[method] = (...args) => {
      logger[level](args.map(fmtArg).join(" "));
    };
  }
}

/**
 * Express request-logging middleware. Logs method, path, status and duration
 * once the response finishes, choosing the level by status class
 * (5xx → error, 4xx → warn, else info). Health probes are skipped to keep
 * logs quiet.
 */
function requestLogger(req, res, next) {
  if (req.originalUrl === "/healthz" || req.originalUrl === "/") return next();
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
}

module.exports = { logger, patchConsole, requestLogger };
