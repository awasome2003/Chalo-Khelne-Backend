/**
 * Canonical Match Format Utilities.
 *
 * - sanitizeBySportType: strips fields irrelevant to the sport's scoring type
 * - validateCustomRules: validates user-defined rules
 * - normalizeMatchFormat: computes derived fields (setsToWin, gamesToWin)
 * - SAFE_DEFAULTS: fallback for any missing field
 * - freezeMatchFormat: creates immutable copy for match documents
 */

// ════════════════════════════════════
// SPORT SCORING TYPE DETECTION
// ════════════════════════════════════

const SPORT_SCORING_TYPES = {
  "Table Tennis": "sets",
  "Badminton": "sets",
  "Tennis": "sets",
  "Pickleball": "sets",
  "Volleyball": "sets",
  "Squash": "sets",
  "Cricket": "innings",
  "Football": "time",
  "Basketball": "time",
  "Hockey": "time",
  "Kabaddi": "time",
  "Chess": "single",
  "Carrom": "single",
};

function getScoringType(sportName) {
  if (!sportName) return null;
  // Case-insensitive lookup
  const key = Object.keys(SPORT_SCORING_TYPES).find(
    (k) => k.toLowerCase() === sportName.toLowerCase()
  );
  if (!key) {
    console.warn(`[getScoringType] Unknown sport "${sportName}" — no scoringType mapped`);
    return null;
  }
  return SPORT_SCORING_TYPES[key];
}

// ════════════════════════════════════
// FIELD WHITELISTS PER SCORING TYPE
// ════════════════════════════════════

const FIELD_WHITELIST = {
  sets: [
    "totalSets", "pointsPerSet", "pointsPerGame", "gamesPerSet",
    "winByMargin", "deuceEnabled", "maxPointsCap",
    "tiebreakEnabled", "tiebreakPoints", "decidingSetPoints",
    "serviceAlternate",
  ],
  innings: [
    "oversCount", "inningsCount",
    "totalSets", // innings can map to totalSets for match structure
  ],
  time: [
    "halvesCount", "halvesDuration",
    "quartersCount", "quartersDuration",
    "totalSets", // periods map to totalSets
  ],
  single: [
    "totalSets", // boards/rounds
  ],
};

// Fields that should NEVER be user-input (always derived server-side)
const DERIVED_FIELDS = ["setsToWin", "gamesToWin", "formatVersion", "scoringType"];

// ════════════════════════════════════
// SAFE DEFAULTS (scoring engine fallback)
// ════════════════════════════════════

/**
 * SAFE_DEFAULTS — used ONLY for legacy matches (pre-migration).
 * Non-legacy matches MUST have explicit matchFormat from tournament config.
 * These defaults are intentionally sport-neutral where possible.
 * Sets-based values are kept for backward compat with existing TT matches.
 */
const SAFE_DEFAULTS = {
  totalSets: 1,
  setsToWin: 1,
  totalGames: 1,
  gamesToWin: 1,
  pointsToWinGame: null,
  marginToWin: null,
  deuceRule: false,
  maxPointsCap: null,
  tiebreakEnabled: false,
  tiebreakPoints: null,
  decidingSetPoints: null,
  serviceAlternate: null,
  oversCount: null,
  inningsCount: null,
  halvesCount: null,
  halvesDuration: null,
  quartersCount: null,
  quartersDuration: null,
  scoringType: null,
  formatVersion: 1,
};

// ════════════════════════════════════
// SANITIZE BY SPORT TYPE
// ════════════════════════════════════

/**
 * Strips fields irrelevant to the sport's scoring type.
 * Prevents mixed config (e.g., oversCount on a Table Tennis tournament).
 *
 * @param {string} sportName - e.g., "Table Tennis"
 * @param {object} rawConfig - flat overrides from frontend
 * @returns {object} cleaned config with only relevant fields
 */
function sanitizeBySportType(sportName, rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") return {};

  const scoringType = getScoringType(sportName);
  const allowed = new Set(FIELD_WHITELIST[scoringType] || FIELD_WHITELIST.sets);
  const cleaned = {};

  for (const [key, value] of Object.entries(rawConfig)) {
    // Skip derived fields (always computed server-side)
    if (DERIVED_FIELDS.includes(key)) continue;
    // Only keep fields relevant to this sport type
    if (allowed.has(key)) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// ════════════════════════════════════
// VALIDATE CUSTOM RULES
// ════════════════════════════════════

/**
 * Validates user-defined rules for unranked tournaments.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
function validateCustomRules(sportName, config) {
  if (!config || typeof config !== "object") return { valid: false, errors: ["Config is required"] };
  if (!sportName) return { valid: false, errors: ["Sport name is required for validation"] };

  const errors = [];
  const scoringType = getScoringType(sportName);

  if (scoringType === "sets") {
    if (config.totalSets != null) {
      if (config.totalSets < 1 || config.totalSets > 9) errors.push("totalSets must be 1-9");
      if (config.totalSets % 2 === 0) errors.push("totalSets must be odd (1, 3, 5, 7, 9)");
    }
    if (config.pointsPerSet != null && (config.pointsPerSet < 1 || config.pointsPerSet > 50)) {
      errors.push("pointsPerSet must be 1-50");
    }
    if (config.pointsPerGame != null && (config.pointsPerGame < 1 || config.pointsPerGame > 50)) {
      errors.push("pointsPerGame must be 1-50");
    }
    if (config.gamesPerSet != null && (config.gamesPerSet < 1 || config.gamesPerSet > 9)) {
      errors.push("gamesPerSet must be 1-9");
    }
    if (config.winByMargin != null && (config.winByMargin < 1 || config.winByMargin > 10)) {
      errors.push("winByMargin must be 1-10");
    }
    if (config.deuceEnabled && config.winByMargin != null && config.winByMargin < 2) {
      errors.push("When deuce is enabled, winByMargin must be at least 2");
    }
  }

  if (scoringType === "innings") {
    if (config.oversCount != null && (config.oversCount < 1 || config.oversCount > 50)) {
      errors.push("oversCount must be 1-50");
    }
    if (config.inningsCount != null && (config.inningsCount < 1 || config.inningsCount > 4)) {
      errors.push("inningsCount must be 1-4");
    }
  }

  if (scoringType === "time") {
    if (config.halvesCount != null && (config.halvesCount < 1 || config.halvesCount > 4)) {
      errors.push("halvesCount must be 1-4");
    }
    if (config.halvesDuration != null && (config.halvesDuration < 1 || config.halvesDuration > 90)) {
      errors.push("halvesDuration must be 1-90 minutes");
    }
    if (config.quartersCount != null && (config.quartersCount < 1 || config.quartersCount > 8)) {
      errors.push("quartersCount must be 1-8");
    }
    if (config.quartersDuration != null && (config.quartersDuration < 1 || config.quartersDuration > 60)) {
      errors.push("quartersDuration must be 1-60 minutes");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ════════════════════════════════════
// NORMALIZE MATCH FORMAT
// ════════════════════════════════════

/**
 * Computes ALL derived fields server-side.
 * Input: raw user config OR sportRules.format + overrides
 * Output: canonical matchFormat ready for database
 *
 * CRITICAL: setsToWin and gamesToWin are NEVER user-input.
 */
function normalizeMatchFormat(sportName, rawConfig, sportRulesFormat) {
  if (!sportName || typeof sportName !== "string") {
    throw new Error("sportName is required for normalizeMatchFormat");
  }
  const scoringType = getScoringType(sportName);
  const rf = sportRulesFormat || {}; // Locked rules (if any)
  const ov = rawConfig || {};        // Overrides (user or custom)

  // Merge: overrides take priority over locked rules
  const totalSets = ov.totalSets || rf.totalSets || SAFE_DEFAULTS.totalSets;
  const gamesPerSet = ov.gamesPerSet || rf.gamesPerSet || null;
  const totalGames = gamesPerSet || totalSets;

  return {
    // Sets-based fields
    totalSets,
    setsToWin: Math.ceil(totalSets / 2),              // DERIVED
    totalGames,
    gamesToWin: Math.ceil(totalGames / 2),             // DERIVED
    pointsToWinGame: ov.pointsPerGame || ov.pointsPerSet || rf.pointsPerGame || rf.pointsPerSet || null,
    marginToWin: ov.winByMargin ?? rf.winByMargin ?? null,
    deuceRule: ov.deuceEnabled ?? rf.deuceEnabled ?? (scoringType === "sets" ? true : false),
    maxPointsCap: ov.maxPointsCap || rf.maxPointsCap || null,
    tiebreakEnabled: ov.tiebreakEnabled ?? rf.tiebreakEnabled ?? false,
    tiebreakPoints: ov.tiebreakPoints || rf.tiebreakPoints || null,
    decidingSetPoints: ov.decidingSetPoints || rf.decidingSetPoints || null,
    serviceAlternate: ov.serviceAlternate ?? rf.serviceAlternate ?? 2,

    // Innings-based fields (null if not applicable)
    oversCount: ov.oversCount ?? rf.oversCount ?? null,
    inningsCount: ov.inningsCount ?? rf.inningsCount ?? null,

    // Time-based fields (null if not applicable)
    halvesCount: ov.halvesCount ?? rf.halvesCount ?? null,
    halvesDuration: ov.halvesDuration ?? rf.halvesDuration ?? null,
    quartersCount: ov.quartersCount ?? rf.quartersCount ?? null,
    quartersDuration: ov.quartersDuration ?? rf.quartersDuration ?? null,

    // Meta
    scoringType,
    formatVersion: 1,
  };
}

// ════════════════════════════════════
// FREEZE MATCH FORMAT
// ════════════════════════════════════

/**
 * Creates a frozen copy of tournament's matchFormat for a match document.
 * Called at match creation time. The match NEVER reads tournament.matchFormat after this.
 *
 * @param {object} tournamentMatchFormat - tournament.matchFormat
 * @returns {object} deep copy for match document
 */
function freezeMatchFormat(tournamentMatchFormat) {
  if (!tournamentMatchFormat) return { ...SAFE_DEFAULTS };

  const tmf = tournamentMatchFormat;
  const scoringType = tmf.scoringType ?? null;
  const isSetBased = scoringType === "sets";

  return {
    totalSets: tmf.totalSets ?? (isSetBased ? 1 : 1),
    setsToWin: tmf.setsToWin ?? (tmf.totalSets ? Math.ceil(tmf.totalSets / 2) : 1),
    totalGames: tmf.totalGames ?? 1,
    gamesToWin: tmf.gamesToWin ?? (tmf.totalGames ? Math.ceil(tmf.totalGames / 2) : 1),
    pointsToWinGame: tmf.pointsToWinGame ?? null,
    marginToWin: tmf.marginToWin ?? null,
    deuceRule: tmf.deuceRule ?? (isSetBased ? true : false),
    maxPointsCap: tmf.maxPointsCap ?? null,
    tiebreakEnabled: tmf.tiebreakEnabled ?? false,
    tiebreakPoints: tmf.tiebreakPoints ?? null,
    decidingSetPoints: tmf.decidingSetPoints ?? null,
    serviceAlternate: tmf.serviceAlternate ?? null,
    oversCount: tmf.oversCount ?? null,
    inningsCount: tmf.inningsCount ?? null,
    halvesCount: tmf.halvesCount ?? null,
    halvesDuration: tmf.halvesDuration ?? null,
    quartersCount: tmf.quartersCount ?? null,
    quartersDuration: tmf.quartersDuration ?? null,
    scoringType,
    formatVersion: tmf.formatVersion ?? 1,
  };
}

// ════════════════════════════════════
// SHAPE DETECTION (private)
// ════════════════════════════════════

/**
 * PRIVATE: Detects whether a format uses the 4-level nested structure (Tennis)
 * or the flat 3-level structure (Table Tennis, Badminton, etc.).
 *
 * TRUE  → Tennis-style: `gamesPerSet` set, OR totalGames > 1 AND != totalSets
 * FALSE → Flat: a "set" is atomic, scored directly to a point total
 *
 * This is a local copy of the public MatchFactory.hasNestedGames helper.
 * Kept private here to avoid a circular require (MatchFactory requires this file).
 * Consolidation TODO after the refactor lands.
 */
function _hasNestedGamesShape(format) {
  if (!format || typeof format !== "object") return false;
  if (format.gamesPerSet != null && Number(format.gamesPerSet) > 0) return true;
  const tg = Number(format.totalGames);
  const ts = Number(format.totalSets);
  if (Number.isFinite(tg) && Number.isFinite(ts) && tg > 1 && tg !== ts) return true;
  return false;
}

// ════════════════════════════════════
// VALIDATE MATCH FORMAT
// ════════════════════════════════════

/**
 * Validates a matchFormat object for structural integrity.
 * Returns { valid: true } or { valid: false, errors: [...] }
 *
 * Used at:
 * - Tournament creation (after normalizeMatchFormat)
 * - Match generation (after freezeMatchFormat)
 * - readMatchFormat (on every scoring call)
 */
function validateMatchFormat(format) {
  if (!format || typeof format !== "object") return { valid: false, errors: ["matchFormat is null or not an object"] };

  const errors = [];
  const scoringType = format.scoringType || null;
  const isSetBased = scoringType === "sets" || scoringType === null;

  // Universal: totalSets and setsToWin must be >= 1 (even non-set sports use 1 as container)
  if (format.totalSets == null || format.totalSets < 1) errors.push("totalSets must be >= 1");
  if (isSetBased && format.totalSets != null && format.totalSets % 2 === 0) errors.push(`totalSets must be odd (got ${format.totalSets})`);
  if (format.setsToWin == null || format.setsToWin < 1) errors.push("setsToWin must be >= 1");
  if (format.setsToWin != null && format.totalSets != null && format.setsToWin > format.totalSets) {
    errors.push(`setsToWin (${format.setsToWin}) cannot exceed totalSets (${format.totalSets})`);
  }
  // gamesToWin: required only for nested-game sports (Tennis).
  // Flat-set sports (TT, Badminton, Volleyball) legitimately have no games layer.
  if (_hasNestedGamesShape(format)) {
    if (format.gamesToWin == null || format.gamesToWin < 1) {
      errors.push("gamesToWin must be >= 1 for nested-game sports");
    }
  }

  // Set-based sports require pointsToWinGame and marginToWin
  if (isSetBased) {
    if (format.pointsToWinGame == null || format.pointsToWinGame < 1) errors.push("pointsToWinGame must be >= 1 for set-based sports");
    if (format.marginToWin == null || format.marginToWin < 1) errors.push("marginToWin must be >= 1 for set-based sports");

    // Cross-field consistency
    if (format.deuceRule && format.marginToWin != null && format.marginToWin < 2) {
      errors.push("marginToWin must be >= 2 when deuce is enabled");
    }
  }
  // Non-set sports: pointsToWinGame and marginToWin can be null — no validation needed

  return { valid: errors.length === 0, errors };
}

// ════════════════════════════════════
// STRUCTURED LOGGING
// ════════════════════════════════════

function logScoring(level, matchId, tournamentId, message, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module: "SCORING",
    matchId: matchId?.toString() || "unknown",
    tournamentId: tournamentId?.toString() || null,
    message,
    ...(data && { data }),
  };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ════════════════════════════════════
// READ MATCH FORMAT (STRICT)
// ════════════════════════════════════

/**
 * STRICT match format reader for scoring engine.
 *
 * Behavior:
 * - match.matchFormat exists → validate + return
 * - match.matchFormat null + match.isLegacy === true → apply SAFE_DEFAULTS + warn
 * - match.matchFormat null + NOT legacy → THROW (match was not properly initialized)
 *
 * NEVER silently applies defaults to non-legacy matches.
 * setsToWin/gamesToWin are ONLY re-derived if missing, never if present.
 */
function readMatchFormat(match) {
  if (!match) throw new Error("[SCORING] readMatchFormat called with null match");

  const matchId = match._id || match.matchId || "unknown";
  const tournamentId = match.tournamentId || null;
  const fmt = match.matchFormat;

  // Case 1: No matchFormat at all
  if (!fmt) {
    // Legacy matches (created before freeze was implemented) get safe defaults
    if (match.isLegacy === true) {
      logScoring("warn", matchId, tournamentId, "Legacy match has no matchFormat — applying SAFE_DEFAULTS");
      return { ...SAFE_DEFAULTS };
    }
    // Non-legacy: strict failure
    logScoring("error", matchId, tournamentId, "Match has NO matchFormat and is not marked as legacy");
    throw new Error(`Match ${matchId} has no matchFormat. Cannot score without format configuration.`);
  }

  // Case 2: matchFormat exists — validate and fill gaps
  const result = { ...fmt._doc || fmt }; // Handle Mongoose subdocuments
  const filled = [];
  const scoringType = result.scoringType || null;
  const isSetBased = scoringType === "sets" || scoringType === null; // null = legacy TT matches

  // Fill ONLY if missing — NEVER override existing values.
  // Shape-aware: flat-set sports (TT, Badminton) legitimately have null totalGames/gamesToWin.
  const nested = _hasNestedGamesShape(result);

  if (result.totalSets == null) { result.totalSets = isSetBased ? (SAFE_DEFAULTS.totalSets || 1) : 1; filled.push("totalSets"); }
  // totalGames: only auto-fill for nested-game sports. Flat-set: null is legitimate.
  if (result.totalGames == null && nested) { result.totalGames = SAFE_DEFAULTS.totalGames || 1; filled.push("totalGames"); }
  // pointsToWinGame and marginToWin: only fill for set-based sports (legacy compat)
  if (result.pointsToWinGame == null && isSetBased) { result.pointsToWinGame = 11; filled.push("pointsToWinGame(legacy-sets)"); }
  if (result.marginToWin == null && isSetBased) { result.marginToWin = 2; filled.push("marginToWin(legacy-sets)"); }
  if (result.deuceRule == null) { result.deuceRule = isSetBased; filled.push("deuceRule"); }

  // Derive ONLY if missing — do NOT override existing values.
  if (result.setsToWin == null) { result.setsToWin = Math.ceil(result.totalSets / 2); filled.push("setsToWin(derived)"); }
  // gamesToWin: only derive for nested-game sports. Flat-set: null is legitimate.
  if (result.gamesToWin == null && nested && result.totalGames != null) {
    result.gamesToWin = Math.ceil(result.totalGames / 2); filled.push("gamesToWin(derived)");
  }

  if (filled.length > 0) {
    logScoring("warn", matchId, tournamentId, `Incomplete matchFormat — filled: ${filled.join(", ")}`, { filledFields: filled });
  }

  // Validate structural integrity
  const validation = validateMatchFormat(result);
  if (!validation.valid) {
    logScoring("error", matchId, tournamentId, `matchFormat validation FAILED`, { errors: validation.errors, format: result });
    throw new Error(`Match ${matchId} has invalid matchFormat: ${validation.errors.join("; ")}`);
  }

  return result;
}

/**
 * Legacy single-field reader (backward compat for non-scoring uses).
 */
function readMatchFormatField(matchFormat, field) {
  if (matchFormat && matchFormat[field] != null) return matchFormat[field];
  return SAFE_DEFAULTS[field] ?? null;
}

module.exports = {
  getScoringType,
  sanitizeBySportType,
  validateCustomRules,
  normalizeMatchFormat,
  freezeMatchFormat,
  readMatchFormat,
  readMatchFormatField,
  SAFE_DEFAULTS,
  FIELD_WHITELIST,
};
