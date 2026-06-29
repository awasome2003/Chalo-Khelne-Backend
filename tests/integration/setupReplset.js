"use strict";
/**
 * Transaction test harness — like setup.js, but backs the in-memory MongoDB with
 * a single-node REPLICA SET. MongoDB transactions (session.withTransaction) only
 * work on a replica set / mongos; a standalone mongod throws "Transaction numbers
 * are only allowed on a replica set member or mongos". Atlas (prod) is a replica
 * set, so this mirrors production for the transaction paths.
 */
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test_secret_at_least_32_chars_long_0000";
process.env.NODE_ENV = "test";

let replset;
let app;
let createApp;

async function startTxApp() {
  mongoose.set("autoIndex", false);
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  ({ createApp } = require("../../app"));
  app = createApp();
  return app;
}

async function stopTxApp() {
  await mongoose.disconnect();
  if (replset) await replset.stop();
}

function superAdminToken() {
  return jwt.sign(
    { email: "qa-superadmin@test.local", role: "superadmin", userId: new mongoose.Types.ObjectId() },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

/** Mint a Manager token (decoded.id = manager _id), for manager-auth routes. */
function managerToken(managerId) {
  return jwt.sign({ id: String(managerId), role: "Manager" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

module.exports = { startTxApp, stopTxApp, superAdminToken, managerToken, clearDatabase, getApp: () => app };
