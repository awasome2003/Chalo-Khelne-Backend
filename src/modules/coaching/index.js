"use strict";
/**
 * Coaching module — PUBLIC interface.
 *
 * Other modules must import coaching ONLY through this file (the service), never
 * its repository or models. This is the seam that keeps cross-module
 * communication going through service interfaces (Phase 4 boundary rule #2).
 *
 *   const coaching = require("../coaching"); // ✅ allowed
 *   const repo = require("../coaching/coaching.repository"); // ❌ forbidden
 */
module.exports = require("./coaching.service");
