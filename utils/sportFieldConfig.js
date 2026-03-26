/**
 * Sport Field Configuration Utility
 *
 * Drives dynamic form rendering, validation, and backend safety
 * based on sport config JSON from DB. Zero hardcoding — if a new
 * sport is added by super admin, forms auto-adapt.
 *
 * Used by both backend (CommonJS) and frontend (ES module copy).
 */

// ─── Field Metadata Registry ───
// Every possible matchFormat key with its UI type, constraints, and default label.
const FIELD_META = {
  totalSets:        { label: "Total Sets",             type: "number",  min: 1,  max: 9,   step: 2 },
  gamesPerSet:      { label: "Games Per Set",          type: "number",  min: 1,  max: 15 },
  pointsPerSet:     { label: "Points Per Set",         type: "number",  min: 1,  max: 50 },
  pointsPerGame:    { label: "Points Per Game",        type: "number",  min: 1,  max: 50 },
  winByMargin:      { label: "Win By Margin",          type: "number",  min: 0,  max: 10 },
  maxPointsCap:     { label: "Max Points Cap",         type: "number",  min: 1,  max: 100 },
  deuceEnabled:     { label: "Deuce Enabled",          type: "boolean" },
  deuceMinPoints:   { label: "Deuce Min Points",       type: "number",  min: 0,  max: 50 },
  tiebreakEnabled:  { label: "Tiebreak Enabled",       type: "boolean" },
  tiebreakPoints:   { label: "Tiebreak Points",        type: "number",  min: 1,  max: 20 },
  decidingSetPoints:{ label: "Deciding Set Points",    type: "number",  min: 1,  max: 50 },
  serviceRules:     { label: "Service Rules",          type: "select",  options: ["rally", "alternate-2", "alternate-game", "side-out", "rotate"] },
  oversCount:       { label: "Overs Count",            type: "number",  min: 1,  max: 50 },
  inningsCount:     { label: "Innings Count",          type: "number",  min: 1,  max: 4 },
  halvesCount:      { label: "Halves",                 type: "number",  min: 1,  max: 4 },
  halvesDuration:   { label: "Half Duration (min)",    type: "number",  min: 1,  max: 90 },
  quartersCount:    { label: "Quarters",               type: "number",  min: 1,  max: 8 },
  quartersDuration: { label: "Quarter Duration (min)", type: "number",  min: 1,  max: 30 },
};

// ─── TASK 1: Field Visibility Algorithm ───

/**
 * Returns an array of matchFormat field keys that should be visible
 * for the given sport. Driven entirely by scoringType + non-null values.
 *
 * Rules:
 *  1. scoringType "sets-games-points" → sets fields + deuce/tiebreak toggles
 *  2. scoringType "innings-overs"     → overs + innings
 *  3. halvesCount non-null            → halvesCount + halvesDuration
 *  4. quartersCount non-null          → quartersCount + quartersDuration
 *  5. All NULL fields hidden automatically
 *
 * @param {Object} sport - Sport document from DB (must have scoringType + matchFormat)
 * @returns {string[]} Array of visible matchFormat field keys
 */
function getVisibleFields(sport) {
  if (!sport || !sport.matchFormat) return [];

  const { scoringType, matchFormat: mf } = sport;
  const visible = [];

  const hasValue = (key) => mf[key] !== null && mf[key] !== undefined;
  const push = (key) => { if (!visible.includes(key)) visible.push(key); };

  // Rule 1: Sets-games-points scoring
  if (scoringType === "sets-games-points") {
    if (hasValue("totalSets"))        push("totalSets");
    if (hasValue("pointsPerSet"))     push("pointsPerSet");
    if (hasValue("gamesPerSet"))      push("gamesPerSet");
    if (hasValue("pointsPerGame"))    push("pointsPerGame");
    if (hasValue("winByMargin"))      push("winByMargin");
    if (hasValue("maxPointsCap"))     push("maxPointsCap");
    // Deuce & tiebreak toggles always shown for sets-based sports
    push("deuceEnabled");
    if (mf.deuceEnabled && hasValue("deuceMinPoints")) push("deuceMinPoints");
    push("tiebreakEnabled");
    if (mf.tiebreakEnabled && hasValue("tiebreakPoints")) push("tiebreakPoints");
    if (hasValue("decidingSetPoints")) push("decidingSetPoints");
    if (hasValue("serviceRules"))      push("serviceRules");
  }

  // Rule 2: Innings-overs scoring
  if (scoringType === "innings-overs") {
    if (hasValue("oversCount"))   push("oversCount");
    if (hasValue("inningsCount")) push("inningsCount");
  }

  // Rule 3: Halves (Football, Hockey, Kabaddi, or any future sport)
  if (hasValue("halvesCount") || scoringType === "halves-goals") {
    if (hasValue("halvesCount"))    push("halvesCount");
    if (hasValue("halvesDuration")) push("halvesDuration");
  }

  // Rule 4: Quarters (Basketball, or any future sport)
  if (hasValue("quartersCount") || scoringType === "quarters-points") {
    if (hasValue("quartersCount"))    push("quartersCount");
    if (hasValue("quartersDuration")) push("quartersDuration");
  }

  // Rule 5: single-score / custom — show any non-null, non-false-boolean fields
  if (scoringType === "single-score" || scoringType === "custom") {
    for (const key of Object.keys(FIELD_META)) {
      if (hasValue(key) && !visible.includes(key)) {
        // Skip boolean fields that are false (no point showing disabled toggles)
        if (FIELD_META[key].type === "boolean" && mf[key] === false) continue;
        push(key);
      }
    }
  }

  return visible;
}

// ─── TASK 2: Fields with Display Metadata ───

/**
 * Returns visible fields enriched with metadata + display labels
 * from the sport's displayConfig. Ready for React form rendering.
 *
 * @param {Object} sport - Sport document from DB
 * @returns {Array<{key, value, label, type, min?, max?, step?, options?}>}
 */
function getFieldsWithMeta(sport) {
  const visibleKeys = getVisibleFields(sport);
  const dc = sport?.displayConfig || {};
  const mf = sport?.matchFormat || {};

  return visibleKeys.map((key) => {
    const meta = { ...FIELD_META[key] };

    // Override labels with sport's displayConfig
    if (key === "totalSets" && dc.setLabel)
      meta.label = `Total ${dc.setLabel}s`;
    if (key === "pointsPerSet" && dc.scoreLabel)
      meta.label = `${dc.scoreLabel} Per ${dc.setLabel || "Set"}`;
    if (key === "pointsPerGame" && dc.scoreLabel)
      meta.label = `${dc.scoreLabel} Per Game`;
    if (key === "decidingSetPoints" && dc.setLabel)
      meta.label = `Deciding ${dc.setLabel} ${dc.scoreLabel || "Points"}`;
    if (key === "oversCount")
      meta.label = dc.pointLabel ? `${dc.pointLabel}s` : "Overs";
    if (key === "tiebreakPoints")
      meta.label = `Tiebreak ${dc.scoreLabel || "Points"}`;

    return {
      key,
      value: mf[key],
      ...meta,
    };
  });
}

// ─── TASK 3: Validation Layer ───

/**
 * Generates validation rules dynamically — only for visible fields.
 * Required fields = only the fields that are visible for this sport.
 *
 * @param {Object} sport - Sport document from DB
 * @returns {Object} Map of field key → { required, type, min?, max?, options? }
 */
function getValidationRules(sport) {
  const visibleKeys = getVisibleFields(sport);
  const rules = {};

  // Fields that are conditionally visible and should NOT be required
  const optionalFields = new Set([
    "deuceMinPoints", "tiebreakPoints", "decidingSetPoints",
    "serviceRules", "maxPointsCap",
  ]);

  visibleKeys.forEach((key) => {
    const meta = FIELD_META[key];
    if (!meta) return;

    const isOptional = optionalFields.has(key);

    if (meta.type === "number") {
      rules[key] = { required: !isOptional, type: "number", min: meta.min, max: meta.max };
    } else if (meta.type === "boolean") {
      rules[key] = { required: false, type: "boolean" };
    } else if (meta.type === "select") {
      rules[key] = { required: !isOptional, type: "string", options: meta.options };
    }
  });

  return rules;
}

/**
 * Validates matchFormat values against the sport's dynamic rules.
 *
 * @param {Object} values - The matchFormat values from form / request body
 * @param {Object} sport  - Sport document from DB
 * @returns {{ valid: boolean, errors: Object }}
 */
function validateMatchFormat(values, sport) {
  const rules = getValidationRules(sport);
  const errors = {};

  for (const [key, rule] of Object.entries(rules)) {
    const val = values[key];

    // Required check
    if (rule.required && (val === null || val === undefined || val === "")) {
      errors[key] = `${FIELD_META[key]?.label || key} is required`;
      continue;
    }

    // Number range check
    if (rule.type === "number" && val != null && val !== "") {
      const num = Number(val);
      if (isNaN(num)) {
        errors[key] = `${FIELD_META[key]?.label || key} must be a number`;
      } else if (rule.min != null && num < rule.min) {
        errors[key] = `Minimum value is ${rule.min}`;
      } else if (rule.max != null && num > rule.max) {
        errors[key] = `Maximum value is ${rule.max}`;
      }
    }

    // Select options check
    if (rule.type === "string" && rule.options && val != null && val !== "") {
      if (!rule.options.includes(val)) {
        errors[key] = `Invalid value. Allowed: ${rule.options.join(", ")}`;
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── TASK 4: Backend Safety — Sanitize ───

/**
 * Strips matchFormat down to only the fields relevant to the selected sport.
 * Extra/irrelevant fields are silently dropped.
 *
 * @param {Object} values - Raw matchFormat from request body
 * @param {Object} sport  - Sport document from DB
 * @returns {Object} Sanitized matchFormat with only visible fields
 */
function sanitizeMatchFormat(values, sport) {
  const visibleKeys = getVisibleFields(sport);
  const sanitized = {};

  for (const key of visibleKeys) {
    if (values[key] !== undefined) {
      const meta = FIELD_META[key];
      if (meta?.type === "number") {
        sanitized[key] = Number(values[key]);
      } else if (meta?.type === "boolean") {
        sanitized[key] = Boolean(values[key]);
      } else {
        sanitized[key] = values[key];
      }
    }
  }

  return sanitized;
}

// ─── Exports ───

module.exports = {
  FIELD_META,
  getVisibleFields,
  getFieldsWithMeta,
  getValidationRules,
  validateMatchFormat,
  sanitizeMatchFormat,
};
