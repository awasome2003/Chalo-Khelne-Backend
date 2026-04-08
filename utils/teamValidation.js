/**
 * Team Size Validation — sport-aware team roster enforcement.
 *
 * Validates that team size matches sport requirements.
 * Used at:
 *   - Tournament registration (BookingModel)
 *   - Team knockout creation (TeamKnockoutTeams)
 *   - Roster updates
 */

// ════════════════════════════════════
// SPORT TEAM SIZE CONFIG
// ════════════════════════════════════

const SPORT_TEAM_SIZES = {
  // Racquet sports (1v1 or 2v2)
  "Table Tennis": { min: 1, max: 3, typical: 1, allowedSizes: [1, 2, 3] },
  "Badminton":    { min: 1, max: 2, typical: 1, allowedSizes: [1, 2] },
  "Tennis":       { min: 1, max: 2, typical: 1, allowedSizes: [1, 2] },
  "Pickleball":   { min: 1, max: 2, typical: 1, allowedSizes: [1, 2] },
  "Squash":       { min: 1, max: 1, typical: 1, allowedSizes: [1] },

  // Team sports
  "Cricket":      { min: 6, max: 15, typical: 11, allowedSizes: null }, // Range-based
  "Football":     { min: 5, max: 18, typical: 11, allowedSizes: null },
  "Basketball":   { min: 5, max: 12, typical: 5,  allowedSizes: null },
  "Volleyball":   { min: 6, max: 12, typical: 6,  allowedSizes: null },
  "Hockey":       { min: 6, max: 16, typical: 11, allowedSizes: null },
  "Kabaddi":      { min: 7, max: 12, typical: 7,  allowedSizes: null },

  // Board/Individual sports
  "Chess":        { min: 1, max: 1, typical: 1, allowedSizes: [1] },
  "Carrom":       { min: 1, max: 2, typical: 1, allowedSizes: [1, 2] },
  "Snooker":      { min: 1, max: 1, typical: 1, allowedSizes: [1] },
};

/**
 * Get team size config for a sport.
 * Returns null for unknown sports (allows any size).
 */
function getTeamSizeConfig(sportName) {
  if (!sportName) return null;
  const key = Object.keys(SPORT_TEAM_SIZES).find(
    (k) => k.toLowerCase() === sportName.toLowerCase()
  );
  return key ? SPORT_TEAM_SIZES[key] : null;
}

/**
 * Validate team size for a sport.
 *
 * @param {number} teamSize - Number of players
 * @param {string} sportName - Sport name
 * @returns {{ valid: boolean, error?: string, config?: Object }}
 */
function validateTeamSize(teamSize, sportName) {
  const config = getTeamSizeConfig(sportName);

  // Unknown sport — allow any team size
  if (!config) {
    return { valid: true, config: null };
  }

  if (teamSize < config.min) {
    return {
      valid: false,
      error: `${sportName} requires at least ${config.min} player(s). Got ${teamSize}.`,
      config,
    };
  }

  if (teamSize > config.max) {
    return {
      valid: false,
      error: `${sportName} allows at most ${config.max} player(s). Got ${teamSize}.`,
      config,
    };
  }

  // For discrete-size sports (racquet/board), check exact sizes
  if (config.allowedSizes && !config.allowedSizes.includes(teamSize)) {
    return {
      valid: false,
      error: `${sportName} requires exactly ${config.allowedSizes.join(" or ")} player(s). Got ${teamSize}.`,
      config,
    };
  }

  return { valid: true, config };
}

/**
 * Get typical team size for a sport.
 * Useful for pre-filling registration forms.
 */
function getTypicalTeamSize(sportName) {
  const config = getTeamSizeConfig(sportName);
  return config?.typical || 1;
}

module.exports = {
  SPORT_TEAM_SIZES,
  getTeamSizeConfig,
  validateTeamSize,
  getTypicalTeamSize,
};
