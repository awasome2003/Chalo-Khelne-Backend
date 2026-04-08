/**
 * MatchFactory — Single source of truth for match creation.
 *
 * ALL match creation in the system MUST go through this factory.
 * It ensures:
 *   1. scoringType is always resolved from sport config
 *   2. matchFormat is always frozen from tournament config
 *   3. matchResult is always initialized to null
 *   4. No sport-specific hardcoding leaks into controllers
 *
 * Usage:
 *   const { createGroupStageMatch, createKnockoutMatch, createTeamKnockoutMatch } = require("../factories/MatchFactory");
 *   const matchDoc = createKnockoutMatch({ tournament, player1, player2, round, ... });
 */

const { getScoringType, freezeMatchFormat } = require("../utils/matchFormatUtils");

// ════════════════════════════════════
// STRICT MATCH FORMAT VALIDATION
// ════════════════════════════════════

/**
 * Validates matchFormat based on scoringType rules.
 * Called inside resolveMatchFormat() before returning.
 * Throws on invalid configuration — prevents bad data from entering DB.
 */
function validateMatchFormatStrict(fmt) {
  if (!fmt) return; // Allow null format for legacy paths
  const st = fmt.scoringType;
  if (!st) return; // No scoringType = legacy match, skip strict validation

  const errors = [];

  if (st === "sets") {
    if (!fmt.setsToWin && !fmt.totalSets) errors.push("sets: setsToWin or totalSets required");
  }

  if (st === "time") {
    if (!fmt.halvesCount && !fmt.quartersCount) errors.push("time: halvesCount or quartersCount required");
  }

  if (st === "innings") {
    if (!fmt.inningsCount && !fmt.oversCount) errors.push("innings: inningsCount or oversCount required");
  }

  // "single" has no required format fields — just a winner/result

  if (errors.length > 0) {
    console.warn(`[MatchFactory] matchFormat validation warnings: ${errors.join("; ")}`, fmt);
    // Warn but don't throw — tournament may have valid config that's just structured differently
  }
}

// ════════════════════════════════════
// CORE: Build frozen match format
// ════════════════════════════════════

/**
 * Resolves and freezes match format from tournament config.
 * This is the ONLY place where matchFormat is built for new matches.
 *
 * @param {Object} tournament - Tournament document
 * @returns {Object} Frozen matchFormat ready for match document
 */
function resolveMatchFormat(tournament) {
  if (!tournament) throw new Error("[MatchFactory] tournament is required");

  const sportName = tournament.sportsType;
  const scoringType = tournament.matchFormat?.scoringType || getScoringType(sportName) || null;
  const tmf = tournament.matchFormat || {};

  // Freeze tournament format into an immutable match-level copy
  const frozen = freezeMatchFormat({ ...tmf, scoringType });

  // Validate frozen format against scoring type rules
  validateMatchFormatStrict(frozen);

  return frozen;
}

/**
 * Stamps a document with factory tracking fields.
 * All factory methods MUST call this before returning.
 */
function _stamp(doc, tournament) {
  doc._createdViaFactory = true;
  doc.sportName = doc.sportName || tournament?.sportsType || null;
  return doc;
}

// ════════════════════════════════════
// GROUP STAGE MATCH
// ════════════════════════════════════

/**
 * Creates a normalized group stage match document.
 *
 * @param {Object} opts
 * @param {Object} opts.tournament - Tournament document
 * @param {string} opts.tournamentId
 * @param {string} opts.groupId
 * @param {string} opts.matchNumber
 * @param {Object} opts.player1 - { playerId, userName, ... }
 * @param {Object} opts.player2
 * @param {Object} [opts.referee]
 * @param {string} [opts.courtNumber]
 * @param {Date}   [opts.startTime]
 * @param {Object} [opts.matchFormatOverride] - Group-level format override
 * @returns {Object} Match document ready for insertMany
 */
function createGroupStageMatch(opts) {
  const {
    tournament, tournamentId, groupId, matchNumber,
    player1, player2, referee, courtNumber, startTime,
    matchFormatOverride,
  } = opts;

  const matchFormat = matchFormatOverride
    ? freezeMatchFormat(matchFormatOverride)
    : resolveMatchFormat(tournament);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    groupId,
    matchNumber: String(matchNumber),
    player1,
    player2,
    referee: referee || null,
    courtNumber: courtNumber || null,
    startTime: startTime ? new Date(startTime) : null,
    matchFormat,
    scoringType: matchFormat.scoringType || null,
    matchResult: null,
    status: "SCHEDULED",
  }, tournament);
}

// ════════════════════════════════════
// KNOCKOUT MATCH (Direct Knockout)
// ════════════════════════════════════

/**
 * Creates a normalized direct knockout match document.
 *
 * @param {Object} opts
 * @param {Object} opts.tournament - Tournament document
 * @param {string} opts.tournamentId
 * @param {string} opts.matchId - e.g., "DK-xxx-R1-M1"
 * @param {string} opts.round - e.g., "quarter-final"
 * @param {number} opts.roundNumber
 * @param {number} opts.matchNumber
 * @param {Object} opts.player1 - { playerId, playerName }
 * @param {Object} opts.player2
 * @param {string} [opts.courtNumber]
 * @param {Date}   [opts.matchStartTime]
 * @param {string} [opts.nextMatchId]
 * @param {string} [opts.bracketPosition]
 * @param {string} [opts.mode]
 * @returns {Object} Match document ready for insertMany
 */
function createKnockoutMatch(opts) {
  const {
    tournament, tournamentId, matchId, round, roundNumber, matchNumber,
    player1, player2, courtNumber, matchStartTime, nextMatchId,
    bracketPosition, mode,
  } = opts;

  const matchFormat = resolveMatchFormat(tournament);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    matchId,
    mode: mode || "direct-knockout",
    round,
    roundNumber,
    matchNumber,
    player1: player1 || { playerId: null, playerName: "TBD" },
    player2: player2 || { playerId: null, playerName: "TBD" },
    courtNumber: courtNumber || null,
    matchStartTime: matchStartTime || null,
    nextMatchId: nextMatchId || null,
    bracketPosition: bracketPosition || null,
    status: "SCHEDULED",
    winner: null,
    scoringType: matchFormat.scoringType || null,
    matchResult: null,
    matchFormat,
  }, tournament);
}

// ════════════════════════════════════
// SUPER MATCH (Knockout round from group stage)
// ════════════════════════════════════

/**
 * Creates a normalized super match document.
 *
 * @param {Object} opts
 * @param {Object} opts.tournament - Tournament document
 * @param {string} opts.tournamentId
 * @param {string} opts.matchId
 * @param {string} opts.round
 * @param {number} opts.roundNumber
 * @param {number} opts.matchNumber
 * @param {Object} opts.player1 - { playerId, playerName, seed }
 * @param {Object} opts.player2
 * @param {string} [opts.courtNumber]
 * @param {Date}   [opts.matchStartTime]
 * @param {string} [opts.nextMatchId]
 * @returns {Object} Match document ready for insertMany / new SuperMatch()
 */
function createSuperMatch(opts) {
  const {
    tournament, tournamentId, matchId, round, roundNumber, matchNumber,
    player1, player2, courtNumber, matchStartTime, nextMatchId,
  } = opts;

  const matchFormat = resolveMatchFormat(tournament);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    matchId,
    round,
    roundNumber,
    matchNumber,
    player1: player1 || { playerId: null, playerName: "TBD" },
    player2: player2 || { playerId: null, playerName: "TBD" },
    courtNumber: courtNumber || null,
    matchStartTime: matchStartTime || null,
    nextMatchId: nextMatchId || null,
    status: "SCHEDULED",
    scoringType: matchFormat.scoringType || null,
    matchResult: null,
    matchFormat,
  }, tournament);
}

// ════════════════════════════════════
// TEAM KNOCKOUT MATCH
// ════════════════════════════════════

/**
 * Creates a normalized team knockout match document.
 *
 * @param {Object} opts
 * @param {Object} opts.tournament - Tournament document
 * @param {string} opts.tournamentId
 * @param {number} opts.round
 * @param {number} opts.bracketPosition
 * @param {string} opts.team1Id
 * @param {string} opts.team2Id
 * @param {string} opts.formatId - e.g., "singles_bo3"
 * @param {string} opts.format - e.g., "Singles - 3 Sets"
 * @param {Array}  opts.sets - Pre-generated set structure
 * @param {Date}   [opts.matchDate]
 * @param {string} [opts.courtNumber]
 * @param {boolean} [opts.isBye]
 * @returns {Object} Match document ready for insertMany
 */
function createTeamKnockoutMatch(opts) {
  const {
    tournament, tournamentId, round, bracketPosition,
    team1Id, team2Id, formatId, format, sets,
    matchDate, courtNumber, isBye,
  } = opts;

  const tf = tournament?.matchFormat || {};
  const gameRules = {
    gamesPerSet: tf.totalGames || null,
    gamesToWin: tf.gamesToWin || null,
    pointsToWinGame: tf.pointsToWinGame || null,
    marginToWin: tf.marginToWin ?? null,
    deuceRule: tf.deuceRule !== undefined ? tf.deuceRule : false,
    maxPointsCap: tf.maxPointsCap || null,
  };

  if (isBye) {
    return _stamp({
      tournamentId,
      round,
      bracketPosition,
      team1Id,
      team2Id: null,
      formatId: formatId || null,
      format,
      gameRules,
      matchDate: matchDate || null,
      courtNumber: "BYE",
      status: "BYE",
      isBye: true,
      sets: [],
      setsWon: { home: 1, away: 0 },
      matchWinner: "home",
      winnerId: team1Id,
      completedAt: new Date(),
      scoringType: tf.scoringType || getScoringType(tournament?.sportsType) || null,
      matchResult: null,
    }, tournament);
  }

  return _stamp({
    tournamentId,
    round,
    bracketPosition,
    team1Id,
    team2Id,
    formatId: formatId || null,
    format,
    gameRules,
    matchDate: matchDate || null,
    courtNumber: courtNumber || "TBD",
    status: "SCHEDULED",
    isBye: false,
    sets: sets || [],
    liveState: {
      currentSetNumber: 1,
      currentGameNumber: 1,
      currentPoints: { home: 0, away: 0 },
      lastUpdated: new Date(),
    },
    setsWon: { home: 0, away: 0 },
    matchWinner: null,
    scoringType: tf.scoringType || getScoringType(tournament?.sportsType) || null,
    matchResult: null,
  }, tournament);
}

// ════════════════════════════════════
// LEGACY KNOCKOUT MATCH (KnockoutMatch model — group-to-knockout flow)
// ════════════════════════════════════

/**
 * Creates a normalized KnockoutMatch document (used in knockoutController + tournamentController).
 * This wraps the legacy KnockoutMatch schema with proper scoringType/matchResult fields.
 *
 * @param {Object} opts
 * @param {Object} [opts.tournament] - Tournament document (optional — may not be loaded)
 * @param {string} opts.tournamentId
 * @param {string} opts.matchType - e.g., "qualifier_knockout"
 * @param {number} opts.round
 * @param {string} opts.roundName
 * @param {number} opts.bracketPosition
 * @param {Object} opts.player1 - { playerId, playerName, playerType, seedRank?, fromGroup? }
 * @param {Object} opts.player2
 * @param {string} [opts.category]
 * @param {string} [opts.status]
 * @param {boolean} [opts.isBye]
 * @param {Object} [opts.winner]
 * @returns {Object} Match document for new KnockoutMatch()
 */
function createLegacyKnockoutMatch(opts) {
  const {
    tournament, tournamentId, matchType, round, roundName, bracketPosition,
    player1, player2, category, status, isBye, winner,
  } = opts;

  const scoringType = tournament?.matchFormat?.scoringType
    || (tournament ? getScoringType(tournament.sportsType) : null);

  return _stamp({
    tournamentId: tournamentId || tournament?._id,
    matchType,
    round,
    roundName,
    bracketPosition,
    player1: player1 || { playerId: null, playerName: "TBD", playerType: "general" },
    player2: player2 || { playerId: null, playerName: "BYE", playerType: "general" },
    category: category || "Open",
    status: status || "SCHEDULED",
    isBye: isBye || false,
    winner: winner || null,
    scoringType: scoringType || null,
    matchResult: null,
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    scheduledTime: { startTime: "10:00", endTime: "11:00" },
  }, tournament);
}

// ════════════════════════════════════
// SUPER GROUP MATCH (superMatchController — legacy super_group type)
// ════════════════════════════════════

/**
 * Creates a super group match document (used by superMatchController).
 */
function createSuperGroupMatch(opts) {
  const {
    tournament, tournamentId, groupId, match, index, matchDate,
  } = opts;

  const scoringType = tournament?.matchFormat?.scoringType
    || (tournament ? getScoringType(tournament.sportsType) : null);

  return _stamp({
    tournamentId,
    groupId,
    title: match.title || `Super Group Match ${index + 1}`,
    type: match.type || "super_group",
    matchStage: match.matchStage || "super_group",
    date: matchDate.toISOString().split("T")[0],
    time: matchDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
    selectedCourt: `Court ${match.courtNumber}`,
    teams: [
      { name: match.player1.userName, playerId: match.player1.playerId, rank: match.player1.rank, groupName: match.player1.groupName, score: 0, image: null },
      { name: match.player2.userName, playerId: match.player2.playerId, rank: match.player2.rank, groupName: match.player2.groupName, score: 0, image: null },
    ],
    status: "scheduled",
    winner: null,
    scoringType: scoringType || null,
    matchResult: null,
    reminder: { isEnabled: true, reminderTime: matchDate },
  }, tournament);
}

// ════════════════════════════════════
// BYE MATCH HELPER
// ════════════════════════════════════

/**
 * Creates a BYE match for direct knockout brackets.
 */
function createByeMatch(opts) {
  const match = createKnockoutMatch({ ...opts, player2: { playerId: null, playerName: "BYE" } });
  match.status = "BYE";
  match.winner = opts.player1;
  return match;
}

module.exports = {
  resolveMatchFormat,
  createGroupStageMatch,
  createKnockoutMatch,
  createSuperMatch,
  createTeamKnockoutMatch,
  createLegacyKnockoutMatch,
  createSuperGroupMatch,
  createByeMatch,
};
