// server/middleware/requireSportContext.js
//
// STEP 16 — boundary validators for multi-sport payloads.
//
// These are NOT Express middleware functions. They are inline helpers
// that controllers invoke after their own multipart/JSON parsing has
// run. Trying to slot them in as route-level middleware would force a
// refactor of the parsing flows that controllers already do inline.
//
// Use pattern in a controller:
//
//   const { assertNonEmptySports, handleSportContextError } = require(
//     "../middleware/requireSportContext"
//   );
//   try {
//     const sports = assertNonEmptySports(req.body);
//     ...
//   } catch (err) {
//     if (handleSportContextError(err, res)) return;
//     throw err;
//   }

// Stable error codes — clients can switch on `error` field without
// parsing the human-readable `message`.
const ERR = {
  MULTI_SPORT_REQUIRED:      "MULTI_SPORT_REQUIRED",
  SPORT_SELECTIONS_REQUIRED: "SPORT_SELECTIONS_REQUIRED",
  SPORT_ID_REQUIRED:         "SPORT_ID_REQUIRED",
  SPORT_NOT_IN_TOURNAMENT:   "SPORT_NOT_IN_TOURNAMENT",
  GROUP_MISSING_SPORT:       "GROUP_MISSING_SPORT",
};

class SportContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SportContextError";
    this.code = code;
    this.details = details;
    this.statusCode = 400;
  }
}

// Parse `payload.sports` from JSON string (multipart) or array.
// Throws MULTI_SPORT_REQUIRED on parse error.
function parseSportsField(payload) {
  let arr = payload?.sports;
  if (typeof arr === "string") {
    if (arr === "") {
      throw new SportContextError(
        ERR.MULTI_SPORT_REQUIRED,
        "sports[] required; legacy single-sport payload no longer accepted"
      );
    }
    try {
      arr = JSON.parse(arr);
    } catch (e) {
      throw new SportContextError(
        ERR.MULTI_SPORT_REQUIRED,
        "Invalid sports format: " + e.message
      );
    }
  }
  return arr;
}

// Validates that `payload.sports` exists, is a non-empty array, and
// every entry has the required shape: sportName + non-empty categories[]
// where each category has a non-empty name and (if present) a numeric fee.
// fee:0 is explicitly accepted (free entry).
//
// Returns the parsed array on success; throws SportContextError(MULTI_SPORT_REQUIRED) otherwise.
function assertNonEmptySports(payload) {
  const arr = parseSportsField(payload);

  if (!Array.isArray(arr) || arr.length === 0) {
    throw new SportContextError(
      ERR.MULTI_SPORT_REQUIRED,
      "sports[] required; legacy single-sport payload no longer accepted"
    );
  }

  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (!s || typeof s !== "object") {
      throw new SportContextError(
        ERR.MULTI_SPORT_REQUIRED,
        `sports[${i}] must be an object`
      );
    }
    if (!s.sportName || !String(s.sportName).trim()) {
      throw new SportContextError(
        ERR.MULTI_SPORT_REQUIRED,
        `sports[${i}].sportName is required`
      );
    }
    if (!Array.isArray(s.categories) || s.categories.length === 0) {
      throw new SportContextError(
        ERR.MULTI_SPORT_REQUIRED,
        `sports[${i}].categories must contain at least one category`
      );
    }
    for (let j = 0; j < s.categories.length; j++) {
      const c = s.categories[j];
      if (!c?.name || !String(c.name).trim()) {
        throw new SportContextError(
          ERR.MULTI_SPORT_REQUIRED,
          `sports[${i}].categories[${j}].name is required`
        );
      }
      // fee is optional; when present it must be a real number.
      // typeof 0 === "number" so free entries are accepted.
      if (c.fee !== undefined && c.fee !== null) {
        if (typeof c.fee !== "number" || !Number.isFinite(c.fee)) {
          throw new SportContextError(
            ERR.MULTI_SPORT_REQUIRED,
            `sports[${i}].categories[${j}].fee must be a number`
          );
        }
      }
    }
  }

  return arr;
}

// Validates that `payload.sportSelections` exists, is a non-empty array,
// and every entry has the required shape: categoryName + numeric fee.
//
// Notes:
//  - fee:0 is accepted (free entry).
//  - sportId/sportName are NOT type-checked at the boundary. Frontend
//    serialization varies (string ids vs ObjectId-shaped objects vs
//    populated docs), and Mongoose's schema cast at save time is the
//    authoritative type gate. The controller's resolveSportId helper
//    handles both string and object forms — see sportTrackUtils.js.
//  - Returns the parsed array on success; throws SPORT_SELECTIONS_REQUIRED otherwise.
function assertSportSelections(payload) {
  let arr = payload?.sportSelections;
  if (typeof arr === "string") {
    if (arr === "") {
      throw new SportContextError(
        ERR.SPORT_SELECTIONS_REQUIRED,
        "sportSelections[] required"
      );
    }
    try {
      arr = JSON.parse(arr);
    } catch (e) {
      throw new SportContextError(
        ERR.SPORT_SELECTIONS_REQUIRED,
        "Invalid sportSelections format: " + e.message
      );
    }
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    throw new SportContextError(
      ERR.SPORT_SELECTIONS_REQUIRED,
      "sportSelections[] required"
    );
  }

  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (!s || typeof s !== "object") {
      throw new SportContextError(
        ERR.SPORT_SELECTIONS_REQUIRED,
        `sportSelections[${i}] must be an object`
      );
    }
    if (!s.categoryName || !String(s.categoryName).trim()) {
      throw new SportContextError(
        ERR.SPORT_SELECTIONS_REQUIRED,
        `sportSelections[${i}].categoryName is required`
      );
    }
    if (s.fee === undefined || s.fee === null
        || typeof s.fee !== "number" || !Number.isFinite(s.fee)) {
      throw new SportContextError(
        ERR.SPORT_SELECTIONS_REQUIRED,
        `sportSelections[${i}].fee must be a number`
      );
    }
  }

  return arr;
}

// Ensures `sportId` is one of the entries in tournament.sports[].
// Used by 16d match/group creators.
function assertSportInTournament(sportId, tournament) {
  if (!sportId) {
    throw new SportContextError(
      ERR.SPORT_ID_REQUIRED,
      "sportId is required"
    );
  }
  const sports = Array.isArray(tournament?.sports) ? tournament.sports : [];
  const matched = sports.some(
    (s) => s && s.sportId && String(s.sportId) === String(sportId)
  );
  if (!matched) {
    throw new SportContextError(
      ERR.SPORT_NOT_IN_TOURNAMENT,
      `sportId ${sportId} is not in tournament.sports[]`,
      { tournamentId: String(tournament?._id || ""), sportId: String(sportId) }
    );
  }
}

// Ensures a BookingGroup is loaded and has sportId stamped. Used by
// group-derived create paths (matches/generate, super matches, per-group
// TopPlayers save) so a sport's data flows from the group instead of
// requiring the caller to send sportId twice.
//
// Returns the resolved sportId on success.
function assertGroupHasSport(group) {
  if (!group) {
    throw new SportContextError(
      ERR.GROUP_MISSING_SPORT,
      "BookingGroup not found"
    );
  }
  if (!group.sportId) {
    throw new SportContextError(
      ERR.GROUP_MISSING_SPORT,
      `BookingGroup ${group._id} has no sportId — orphaned/unmigrated`,
      { groupId: String(group._id) }
    );
  }
  return group.sportId;
}

// In a controller catch block: returns true after sending a 400 if the
// error is a SportContextError; returns false otherwise (caller should
// re-throw or handle).
function handleSportContextError(err, res) {
  if (err instanceof SportContextError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err.details || {},
    });
    return true;
  }
  return false;
}

module.exports = {
  ERR,
  SportContextError,
  assertNonEmptySports,
  assertSportSelections,
  assertSportInTournament,
  assertGroupHasSport,
  handleSportContextError,
};
