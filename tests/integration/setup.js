"use strict";
/**
 * Shared integration harness.
 *
 * Boots the REAL Express app (createApp) against an isolated in-memory MongoDB —
 * never touches Atlas. Routes, middleware (auth/RBAC/tenancy), and controllers
 * all run exactly as in production; only the DB and the listen() are swapped.
 *
 * Auth: we mint a SuperAdmin JWT. Per middleware/authMiddleware.js +
 * middleware/rbacMiddleware.js, a SuperAdmin token bypasses requirePermission,
 * scopeTournamentCreate, ownsBodyTournament, and the router.param("matchId")
 * scorer guard — so a single token exercises the full happy path without
 * seeding the RBAC Role/Permission graph.
 */
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

// authMiddleware/socket read JWT_SECRET at call time — set before app handles
// any request. validateEnv() is NOT invoked here (it lives in server.js, not
// app.js), so any >=32 char value is fine for tests.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test_secret_at_least_32_chars_long_0000";
process.env.NODE_ENV = "test";

let mongod;
let app;

async function startTestApp() {
  // Skip unique-index builds — irrelevant to these flows, avoids seed friction.
  mongoose.set("autoIndex", false);
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Require the app AFTER mongoose is configured. createApp() does HTTP wiring
  // only (no listen, no mongo connect) so supertest can drive it directly.
  ({ createApp } = require("../../app"));
  app = createApp();
  return app;
}

async function stopTestApp() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

/** Mint a SuperAdmin access token (role claim = "superadmin"). */
function superAdminToken() {
  const userId = new mongoose.Types.ObjectId();
  return jwt.sign(
    { email: "qa-superadmin@test.local", role: "superadmin", userId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

/** Wipe all collections between tests for isolation. */
async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((c) => c.deleteMany({}))
  );
}

let createApp;
module.exports = {
  startTestApp,
  stopTestApp,
  superAdminToken,
  clearDatabase,
  getApp: () => app,
};
