/**
 * Shared multi-sport `matchFormat` fields.
 *
 * WHY THIS EXISTS
 * ---------------
 * MatchFactory freezes a 24-field format onto every match it creates (see
 * freezeMatchFormat in utils/matchFormatUtils.js). The match models, however,
 * only ever declared the original racquet-sport subset — setsToWin, maxSets,
 * gamesToWin, maxGames, points, deuce and serviceRule. Mongoose drops undeclared
 * paths silently, so 19 of those 24 fields were computed correctly and then
 * thrown away on save. The stored format could not describe a Carrom board
 * count, a Cricket over count, or a football half — and, most damagingly, it
 * did not carry `totalSets`, the field the scoring engine reads to work out how
 * many sets a match actually needs.
 *
 * Spread these into a model's `matchFormat` object alongside its existing
 * fields:
 *
 *   matchFormat: {
 *     ...existing legacy fields (maxSets, maxGames, serviceRule, …),
 *     ...multiSportFormatFields,
 *   }
 *
 * PURELY ADDITIVE. The legacy fields are still read across
 * tournamentController, groupStageScoreboardController and
 * bulkResultUploadController, so nothing here replaces them. Existing documents
 * simply leave the new paths undefined, and readMatchFormat's derivation still
 * covers that case.
 *
 * Every field is nullable with no sport-specific default — the tournament's
 * configuration is the only source of truth, exactly as the format utils intend.
 */

const multiSportFormatFields = {
  // ── Structure ────────────────────────────────────────────────────────────
  // The set/period/board container. `setsToWin` is derived from it, and the
  // scoring engine validates that setsToWin never exceeds it. Its absence is
  // what silently reduced every set-based match to best-of-1.
  totalSets: {
    type: Number,
    default: null,
    min: 1,
    comment: "Total sets/periods/boards in the match (best-of-N container)",
  },
  totalGames: {
    type: Number,
    default: null,
    comment: "Games per set for nested-game sports (Tennis). Null for flat-set sports.",
  },

  // ── Scoring type + version ───────────────────────────────────────────────
  // Mirrors the match-level `scoringType`. Kept on the format too so a format
  // read in isolation is self-describing and validateMatchFormat can pick the
  // right rule branch without the parent document.
  scoringType: {
    type: String,
    enum: ["sets", "innings", "time", "single", "board", null],
    default: null,
    comment: "Sport scoring family this format describes",
  },
  formatVersion: {
    type: Number,
    default: 1,
    comment: "Schema version of the frozen format",
  },

  // ── Set-based extras (racquet sports) ────────────────────────────────────
  maxPointsCap: {
    type: Number,
    default: null,
    comment: "Hard points ceiling that ends a deuce (e.g. 30 in badminton)",
  },
  tiebreakEnabled: {
    type: Boolean,
    default: null,
    comment: "Whether a tiebreak decides a level set",
  },
  tiebreakPoints: {
    type: Number,
    default: null,
    comment: "Points required to take the tiebreak",
  },
  decidingSetPoints: {
    type: Number,
    default: null,
    comment: "Points for the final/deciding set when it differs",
  },
  serviceAlternate: {
    type: Number,
    default: null,
    comment: "Points between service changes",
  },

  // ── Innings-based (Cricket) ──────────────────────────────────────────────
  oversCount: {
    type: Number,
    default: null,
    comment: "Overs per innings",
  },
  inningsCount: {
    type: Number,
    default: null,
    comment: "Innings per side",
  },
  superOver: {
    type: Boolean,
    default: null,
    comment: "Whether a tie is decided by a super over",
  },

  // ── Time-based (Football, Basketball, Hockey, Kabaddi) ───────────────────
  halvesCount: {
    type: Number,
    default: null,
    comment: "Number of halves",
  },
  halvesDuration: {
    type: Number,
    default: null,
    comment: "Minutes per half",
  },
  quartersCount: {
    type: Number,
    default: null,
    comment: "Number of quarters",
  },
  quartersDuration: {
    type: Number,
    default: null,
    comment: "Minutes per quarter",
  },

  // ── Board-based (Carrom) ─────────────────────────────────────────────────
  boardsToWin: {
    type: Number,
    default: null,
    min: 1,
    comment: "Boards needed to win the match (best-of-N)",
  },
  pointsPerBoard: {
    type: Number,
    default: null,
    comment: "Points target per board, when the format sets one",
  },
  queenValue: {
    type: Number,
    default: null,
    comment: "Bonus points for pocketing the queen",
  },
};

module.exports = { multiSportFormatFields };
