/**
 * Express app factory — pure HTTP wiring, no listen() / no SSL / no mongo.
 * server.js wraps this with bootstrap (env, mongo, http/https, sockets).
 */

const express = require("express");
// Install the global async-error wrapper BEFORE any routes are mounted, so every
// route handler (router.get/post/...) is auto-wrapped to forward rejected
// promises to the error handler instead of crashing the process.
require("./utils/asyncHandler").installGlobalAsyncWrapping(express);

const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const mongoSanitize = require("express-mongo-sanitize");
// helmet is loaded defensively so a missing install doesn't crash boot — the
// manual headers below remain as a fallback. Run `npm install helmet`.
let helmet = null;
try { helmet = require("helmet"); } catch (_) { /* not installed yet */ }

const { mountAll } = require("./routes");
const serveUploads = require("./middleware/serveUploads");
const errorHandler = require("./middleware/errorHandler");
const scrubErrorResponses = require("./middleware/scrubErrorResponses");

function createApp() {
  const app = express();

  // Uploads dirs — honor UPLOADS_DIR (mounted persistent disk) like uploads.js,
  // defaulting to <server>/uploads so the static-serve path stays in sync.
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, "uploads");
  const profilesDir = path.join(uploadsDir, "profiles");
  const certificatesDir = path.join(uploadsDir, "certificates");
  [uploadsDir, profilesDir, certificatesDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // Behind a reverse proxy (nginx) in production — required so rate limiting
  // and logging see the real client IP, not the proxy's.
  app.set("trust proxy", 1);

  // Structured request logging (winston). Logs method/path/status/duration per
  // request; skips health probes. Placed early so every route is covered.
  const { requestLogger } = require("./utils/logger");
  app.use(requestLogger);

  // Middleware
  app.use(express.json({ limit: "5mb" }));

  // Security headers via helmet (when installed). CSP is disabled — this is a
  // JSON API and also serves uploaded images, so a strict CSP belongs at the
  // web/CDN layer. crossOriginResourcePolicy is set to "cross-origin" so the
  // web/mobile clients can load images from /uploads on a different origin.
  if (helmet) {
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
      })
    );
  }

  // Minimal security headers — fallback/defense-in-depth (also covers the case
  // where helmet isn't installed yet).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Strip MongoDB operator keys ($gt, $where, …) and dotted keys from
  // req.body/query/params on every route — kills NoSQL operator injection
  // (e.g. login with {"$gt":""}) globally without touching controllers.
  app.use(mongoSanitize());

  // Scrub internal error detail from 5xx responses (prod). Must wrap res.json
  // before route handlers run.
  app.use(scrubErrorResponses);

  // CORS — the native mobile app sends no Origin header and is always allowed.
  // Browser origins (e.g. the SuperAdmin web panel) are restricted via the
  // WEB_ALLOWED_ORIGINS env (comma-separated). If that env is unset, behaviour
  // is unchanged (permissive) so nothing breaks before it's configured.
  const allowedOrigins = (process.env.WEB_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // mobile app / curl / server-to-server
        if (allowedOrigins.length > 0) return cb(null, allowedOrigins.includes(origin));
        // No allowlist configured: fail closed in production, permissive in dev.
        if (process.env.NODE_ENV === "production") return cb(null, false);
        return cb(null, true);
      },
      credentials: true,
      // Let browser clients read pagination metadata (e.g. from getAllTournaments).
      exposedHeaders: ["X-Total-Count", "X-Total-Pages", "X-Page", "X-Limit"],
    })
  );
  // /uploads is NOT blanket-static. Public categories are served statically;
  // identity-docs, certificates and group-chat attachments require auth plus an
  // ownership check. See middleware/serveUploads.js.
  app.use("/uploads", serveUploads(uploadsDir));

  app.locals.directories = {
    uploads: uploadsDir,
    profiles: profilesDir,
    certificates: certificatesDir,
  };

  // Side-effect model loads (preserved from legacy server.js)
  require("./src/modules/identity/models/ClubManager");
  require("./src/modules/catalog/models/Referee");

  // Health check (simple liveness — server is up).
  app.get("/", (_req, res) => res.send("Chalo Khelne API is running"));

  // Readiness probe — confirms downstream deps are ready to serve traffic.
  // Load balancers / Render / k8s should hit this, not "/", so a degraded
  // instance (DB disconnected) is removed from rotation. Returns 200 only
  // when Mongo is in the "connected" state (readyState === 1).
  app.get("/healthz", (_req, res) => {
    const mongoState = mongoose.connection.readyState; // 0 disc / 1 conn / 2 connecting / 3 disconnecting
    const mongoOk = mongoState === 1;
    res.status(mongoOk ? 200 : 503).json({
      status: mongoOk ? "ok" : "degraded",
      mongo: mongoOk,
      mongoState,
      uptimeSec: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    });
  });

  // Routes
  mountAll(app);

  // Error handler — must be last
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
