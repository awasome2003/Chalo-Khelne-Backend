"use strict";
/**
 * Platform DB helpers.
 *
 * runInTransaction — the single, proven transaction wrapper (originally in
 * coaching.repository.js, Phase 3). Lives in platform/ so any layer can use it
 * without a cross-module import. Runs `work(session)` inside a MongoDB
 * transaction; commits on success, aborts (rolls back) on any throw.
 *
 *   await runInTransaction(async (session) => {
 *     await a.save({ session });
 *     await b.save({ session });   // a+b commit together or not at all
 *   });
 *
 * Requires a replica set (MongoDB Atlas in prod; MongoMemoryReplSet in tests).
 */
const mongoose = require("mongoose");

async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

module.exports = { runInTransaction };
