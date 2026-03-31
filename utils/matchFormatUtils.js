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
  if (!sportName) return "sets";
  // Case-insensitive lookup
  const key = Object.keys(SPORT_SCORING_TYPES).find(
    (k) => k.toLowerCase() === sportName.toLowerCase()
  );
  return SPORT_SCORING_TYPES[key] || "sets";
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

const SAFE_DEFAULTS = {
  totalSets: 3,
  setsToWin: 2,
  totalGames: 3,
  gamesToWin: 2,
  pointsToWinGame: 11,
  marginToWin: 2,
  deuceRule: true,
  maxPointsCap: null,
  tiebreakEnabled: false,
  tiebreakPoints: null,
  decidingSetPoints: null,
  serviceAlternate: 2,
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
    pointsToWinGame: ov.pointsPerGame || ov.pointsPerSet || rf.pointsPerGame || rf.pointsPerSet || SAFE_DEFAULTS.pointsToWinGame,
    marginToWin: ov.winByMargin ?? rf.winByMargin ?? SAFE_DEFAULTS.marginToWin,
    deuceRule: ov.deuceEnabled ?? rf.deuceEnabled ?? SAFE_DEFAULTS.deuceRule,
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

  return {
    totalSets: tournamentMatchFormat.totalSets ?? SAFE_DEFAULTS.totalSets,
    setsToWin: tournamentMatchFormat.setsToWin ?? SAFE_DEFAULTS.setsToWin,
    totalGames: tournamentMatchFormat.totalGames ?? SAFE_DEFAULTS.totalGames,
    gamesToWin: tournamentMatchFormat.gamesToWin ?? SAFE_DEFAULTS.gamesToWin,
    pointsToWinGame: tournamentMatchFormat.pointsToWinGame ?? SAFE_DEFAULTS.pointsToWinGame,
    marginToWin: tournamentMatchFormat.marginToWin ?? SAFE_DEFAULTS.marginToWin,
    deuceRule: tournamentMatchFormat.deuceRule ?? SAFE_DEFAULTS.deuceRule,
    maxPointsCap: tournamentMatchFormat.maxPointsCap ?? null,
    tiebreakEnabled: tournamentMatchFormat.tiebreakEnabled ?? false,
    tiebreakPoints: tournamentMatchFormat.tiebreakPoints ?? null,
    decidingSetPoints: tournamentMatchFormat.decidingSetPoints ?? null,
    serviceAlternate: tournamentMatchFormat.serviceAlternate ?? 2,
    oversCount: tournamentMatchFormat.oversCount ?? null,
    inningsCount: tournamentMatchFormat.inningsCount ?? null,
    halvesCount: tournamentMatchFormat.halvesCount ?? null,
    halvesDuration: tournamentMatchFormat.halvesDuration ?? null,
    quartersCount: tournamentMatchFormat.quartersCount ?? null,
    quartersDuration: tournamentMatchFormat.quartersDuration ?? null,
    scoringType: tournamentMatchFormat.scoringType ?? null,
    formatVersion: tournamentMatchFormat.formatVersion ?? 1,
  };
}

/**
 * Read a match format field with safe fallback.
 * Scoring engine should use this instead of direct access.
 *
 * @param {object} matchFormat - match-level frozen format
 * @param {string} field - field name
 * @returns {*} value with safe default fallback
 */
function readMatchFormat(matchFormat, field) {
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
  SAFE_DEFAULTS,
  FIELD_WHITELIST,
};
