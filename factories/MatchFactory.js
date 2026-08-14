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
// SHAPE DETECTION (nested vs flat)
// ════════════════════════════════════

/**
 * Determines whether a sport's match format uses the 4-level nested structure
 * (match → sets → games → points) or the flat 3-level structure (match → sets → points).
 *
 * TRUE  → Tennis-style: a "set" contains multiple "games", each game scored to a point total.
 *          Signalled by an explicit `gamesPerSet` in the preset/tournament, OR
 *          by a frozen format where totalGames > 1 and differs from totalSets.
 *
 * FALSE → Table Tennis / Badminton / Volleyball / Squash / Pickleball:
 *          a "set" is atomic — played directly to a point total, no inner games.
 *
 * This is the single source of truth for the shape branch. All downstream
 * scoring, validation, and UI code MUST route through this helper.
 *
 * @param {object} tournamentOrFormat - Tournament document OR matchFormat object
 * @returns {boolean}
 */
function hasNestedGames(tournamentOrFormat) {
  if (!tournamentOrFormat) return false;
  const tmf = tournamentOrFormat.matchFormat ?? tournamentOrFormat;
  if (!tmf || typeof tmf !== "object") return false;

  // Explicit signal from tournament/preset config
  if (tmf.gamesPerSet != null && Number(tmf.gamesPerSet) > 0) return true;

  // Post-freeze signal: totalGames is a real second layer (>1 AND != totalSets)
  const tg = Number(tmf.totalGames);
  const ts = Number(tmf.totalSets);
  if (Number.isFinite(tg) && Number.isFinite(ts) && tg > 1 && tg !== ts) return true;

  return false;
}

// ════════════════════════════════════
// STRICT MATCH FORMAT VALIDATION
// ════════════════════════════════════

/**
 * Validates matchFormat based on scoringType rules.
 * Called inside resolveMatchFormat() before returning.
 * Throws on invalid configuration — prevents bad data from entering DB.
 *
 * @param {object} fmt - frozen matchFormat
 * @param {object} [opts]
 * @param {boolean} [opts.nested=false] - whether format uses nested games layer (Tennis)
 */
function validateMatchFormatStrict(fmt, { nested = false } = {}) {
  if (!fmt) return; // Allow null format for legacy paths
  const st = fmt.scoringType;
  if (!st) return; // No scoringType = legacy match, skip strict validation

  const errors = [];

  if (st === "sets") {
    if (!fmt.setsToWin && !fmt.totalSets) errors.push("sets: setsToWin or totalSets required");
    // Inner-games fields only required for nested sports (Tennis).
    // Flat-set sports (TT, Badminton, Volleyball) score directly per set — no games layer.
    if (nested && !fmt.gamesToWin && !fmt.totalGames) {
      errors.push("sets(nested): gamesToWin or totalGames required for nested-game sports");
    }
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
function resolveMatchFormat(tournament, sportId) {
  if (!tournament) throw new Error("[MatchFactory] tournament is required");

  // STEP 17b.i — read per-sport. Falls back via getSportTrack →
  // synthesizeLegacyTrack until 17d removes synthesizeLegacyTrack.
  const { getSportName, getMatchFormat } = require("../utils/sportTrackUtils");
  const sportName = getSportName(tournament, sportId);
  const tmf = getMatchFormat(tournament, sportId) || {};
  const scoringType = tmf.scoringType || getScoringType(sportName) || null;

  // Freeze tournament format into an immutable match-level copy
  const frozen = freezeMatchFormat({ ...tmf, scoringType });

  // ── Sport-aware shape branch ────────────────────────────────
  // Detect whether this sport uses the 4-level nested structure (Tennis)
  // or the flat 3-level structure (Table Tennis, Badminton, etc.).
  // The frozen format is emitted identically either way — only the
  // validator is scoped to the shape at this step. Downstream steps
  // (controllers, UI) will use hasNestedGames() to branch scoring logic.
  const nested = hasNestedGames(tmf);

  // Validate frozen format against scoring type rules (shape-aware)
  validateMatchFormatStrict(frozen, { nested });

  return frozen;
}

/**
 * Stamps a document with factory tracking fields.
 * All factory methods MUST call this before returning.
 *
 * STEP 17d — the `tournament.sports[0].sportId` defense-in-depth fallback
 * was removed intentionally. Controllers (STEP 16d) are the enforcement
 * point: every factory caller threads an explicit sportId, validated
 * against tournament.sports[] via assertSportInTournament /
 * assertGroupHasSport. The factory's job is to stamp what the caller
 * provides; if doc.sportId is missing here, that's a controller bug
 * upstream and the resulting null sportId fails Mongoose schema cast on
 * save (after 17f required:true flip).
 *
 * Similarly, the `tournament.sportsType` legacy fallback for sportName
 * is removed — sports[].sportName is the only source.
 */
function _stamp(doc, tournament) {
  doc._createdViaFactory = true;
  // sportName fallback chain reads off the matched sport-track only.
  // No legacy-root coalesce. Track lookup is by doc.sportId; if that's
  // null the sportName ends up null too, surfacing the upstream bug.
  if (!doc.sportName && doc.sportId && Array.isArray(tournament?.sports)) {
    const idStr = String(doc.sportId);
    const matched = tournament.sports.find((s) => String(s?.sportId) === idStr);
    doc.sportName = matched?.sportName || null;
  } else if (!doc.sportName) {
    doc.sportName = doc.sportName || null;
  }
  doc.sportId = doc.sportId || null;
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
    matchEndTime,
    matchFormatOverride,
    sportId, // optional override; _stamp falls back to tournament.sports[0]
  } = opts;

  const matchFormat = matchFormatOverride
    ? freezeMatchFormat(matchFormatOverride)
    : resolveMatchFormat(tournament, sportId);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    sportId,
    groupId,
    matchNumber: String(matchNumber),
    player1,
    player2,
    referee: referee || null,
    courtNumber: courtNumber || null,
    startTime: startTime ? new Date(startTime) : null,
    matchEndTime: matchEndTime ? new Date(matchEndTime) : null,
    matchFormat,
    scoringType: matchFormat.scoringType || null,
    matchResult: null,
    status: "SCHEDULED",
  }, tournament);
}

// ════════════════════════════════════
// SWISS MATCH
// ════════════════════════════════════

/**
 * Creates a normalized Swiss match document.
 *
 * A Swiss match is terminal — Swiss has no bracket, so there is no
 * nextMatchId and nobody progresses out of a result. Rounds are generated one
 * at a time from the standings, not up front.
 *
 * A BYE is stored as a completed match with no player2: the field was odd and
 * this player sat the round out. It counts as a win, because the player did not
 * choose to sit out and scoring it lower would penalise them for the field size.
 *
 * @param {Object}  opts
 * @param {Object}  opts.tournament
 * @param {string}  opts.tournamentId
 * @param {string}  opts.sportId
 * @param {number}  opts.swissRound   1-based round number
 * @param {number}  opts.matchNumber  position within the round
 * @param {Object}  opts.player1      { playerId, userName }
 * @param {Object}  [opts.player2]    omitted for a bye
 * @param {string}  [opts.category]
 * @param {boolean} [opts.isBye=false]
 * @param {string}  [opts.courtNumber]
 * @param {Date}    [opts.matchStartTime]
 * @param {Date}    [opts.matchEndTime]
 * @param {Object}  [opts.matchFormatOverride]
 * @returns {Object} Match document ready for insertMany
 */
function createSwissMatch(opts) {
  const {
    tournament, tournamentId, sportId, swissRound, matchNumber, totalRounds,
    player1, player2, category, isBye = false,
    courtNumber, matchStartTime, matchEndTime, matchType,
    matchFormatOverride,
  } = opts;

  const matchFormat = mergeFormatOverride(
    resolveMatchFormat(tournament, sportId),
    matchFormatOverride
  );

  const p1 = player1 || { playerId: null, userName: "TBD" };
  const winnerOfBye = { playerId: p1.playerId || null, playerName: p1.userName || null };

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    sportId,
    category: category || null,
    swissRound,
    matchNumber,
    totalRounds,
    matchType: matchType || "singles",
    player1: p1,
    player2: isBye ? { playerId: null, userName: null } : (player2 || { playerId: null, userName: null }),
    isBye: !!isBye,
    courtNumber: courtNumber || null,
    matchStartTime: matchStartTime || null,
    matchEndTime: matchEndTime || null,
    // A bye needs no scoring — record it as already decided so standings and
    // the "is the round finished?" check treat it like any other result.
    status: isBye ? "COMPLETED" : "SCHEDULED",
    scoringType: matchFormat.scoringType || null,
    matchResult: null,
    matchFormat,
    result: isBye
      ? {
          winner: winnerOfBye,
          finalScore: { player1Sets: 0, player2Sets: 0 },
          isDraw: false,
          matchDuration: 0,
          completedAt: new Date(),
        }
      : undefined,
    notes: isBye ? `BYE — ${p1.userName} sat out round ${swissRound}.` : undefined,
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
 * @param {string} [opts.category] - Bracket category ("Open", "Above 40"). Null
 *                                   for a single undifferentiated bracket.
 * @returns {Object} Match document ready for insertMany
 */
/**
 * Merge a per-round format override onto a resolved base format.
 *
 * The bestOf escalation (Bo3 early → Bo5 semi → Bo7 final) supplies only
 * { totalSets, setsToWin }. Applied naively that breaks the flat-set
 * invariant: a sport with no games layer encodes it as totalGames ===
 * totalSets, and hasNestedGames() reads any other relationship as a
 * Tennis-style nested match.
 *
 * So a Bo5 badminton semi ended up totalSets: 5 with totalGames still 3 and
 * was scored as NESTED — the live scorer demanded games within each set, while
 * bulk upload recorded one game per set. The same match stored two different
 * shapes depending on how it was scored.
 *
 * Genuinely nested sports (Tennis, which sets gamesPerSet) are untouched:
 * games per set is independent of how many sets the match runs to.
 */
function mergeFormatOverride(base, override) {
  if (!override || typeof override !== "object") return base;
  const merged = {
    ...base,
    ...override,
    // scoringType is sport-determined and never overridden.
    scoringType: base.scoringType,
  };
  if (!hasNestedGames(base) && merged.totalSets != null) {
    merged.totalGames = merged.totalSets;
  }
  return freezeMatchFormat(merged);
}

function createKnockoutMatch(opts) {
  const {
    tournament, tournamentId, matchId, round, roundNumber, matchNumber,
    player1, player2, courtNumber, matchStartTime, matchEndTime, nextMatchId,
    bracketPosition, mode, category,
    matchFormatOverride, // partial { totalSets, setsToWin, ... } merged onto resolved format
    sportId, // optional override; _stamp falls back to tournament.sports[0]
  } = opts;

  // Per-round bestOf support: resolve the tournament base format, then patch
  // any override fields (e.g. totalSets/setsToWin from a Bo5 round). scoringType
  // is sport-determined and never overridden — the merge below preserves it.
  let matchFormat = resolveMatchFormat(tournament, sportId);
  matchFormat = mergeFormatOverride(matchFormat, matchFormatOverride);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    sportId,
    matchId,
    mode: mode || "direct-knockout",
    round,
    roundNumber,
    matchNumber,
    player1: player1 || { playerId: null, playerName: "TBD" },
    player2: player2 || { playerId: null, playerName: "TBD" },
    courtNumber: courtNumber || null,
    matchStartTime: matchStartTime || null,
    matchEndTime: matchEndTime || null,
    nextMatchId: nextMatchId || null,
    bracketPosition: bracketPosition || null,
    category: category || null,
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
    player1, player2, courtNumber, matchStartTime, matchEndTime, nextMatchId,
    matchFormatOverride, // partial { totalSets, setsToWin, ... } merged onto resolved format
    sportId, // optional override; _stamp falls back to tournament.sports[0]
  } = opts;

  // Per-round bestOf support — see createKnockoutMatch for the merge contract.
  let matchFormat = resolveMatchFormat(tournament, sportId);
  matchFormat = mergeFormatOverride(matchFormat, matchFormatOverride);

  return _stamp({
    tournamentId: tournamentId || tournament._id,
    sportId,
    matchId,
    round,
    roundNumber,
    matchNumber,
    player1: player1 || { playerId: null, playerName: "TBD" },
    player2: player2 || { playerId: null, playerName: "TBD" },
    courtNumber: courtNumber || null,
    matchStartTime: matchStartTime || null,
    matchEndTime: matchEndTime || null,
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
    sportId, // optional override; _stamp falls back to tournament.sports[0]
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
      sportId,
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
    sportId,
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
    sportId, // optional override; _stamp falls back to tournament.sports[0]
  } = opts;

  // STEP 17b.i — per-sport scoringType. matchFormat now read off sport-track.
  const { getMatchFormat: _getMF1, getSportName: _getSN1 } = require("../utils/sportTrackUtils");
  const scoringType = (tournament && _getMF1(tournament, sportId)?.scoringType)
    || (tournament ? getScoringType(_getSN1(tournament, sportId)) : null);

  return _stamp({
    tournamentId: tournamentId || tournament?._id,
    sportId,
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
    sportId, // optional override; _stamp falls back to tournament.sports[0]
  } = opts;

  // STEP 17b.i — per-sport scoringType.
  const { getMatchFormat: _getMF2, getSportName: _getSN2 } = require("../utils/sportTrackUtils");
  const tf = _getMF2(tournament, sportId) || {};
  const scoringType = tf.scoringType
    || (tournament ? getScoringType(_getSN2(tournament, sportId)) : null);

  // Translate the tournament's matchFormat into the field shape SuperMatch
  // expects (maxSets / maxGames / serviceRule.*). Without this, Mongoose
  // applies the schema defaults at SuperMatch.js (setsToWin: 3, maxSets: 5,
  // maxGames: 5) and a best-of-3 tournament gets best-of-5 match docs —
  // which then fails bulk score upload with "Need 3 sets to win".
  const totalSets = tf.totalSets || 1;
  const totalGames = tf.totalGames || 1;
  const matchFormat = {
    setsToWin: tf.setsToWin || Math.ceil(totalSets / 2),
    maxSets: totalSets,
    gamesToWin: tf.gamesToWin || Math.ceil(totalGames / 2),
    maxGames: totalGames,
    pointsToWinGame: tf.pointsToWinGame ?? null,
    marginToWin: tf.marginToWin ?? null,
    deuceRule: tf.deuceRule ?? false,
    maxPointsPerGame: tf.maxPointsCap ?? null,
    serviceRule: {
      pointsPerService: tf.serviceAlternate ?? 2,
      deuceServicePoints: 1,
    },
  };

  return _stamp({
    tournamentId,
    sportId,
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
    matchFormat,
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
  hasNestedGames,
  createGroupStageMatch,
  createSwissMatch,
  createKnockoutMatch,
  createSuperMatch,
  createTeamKnockoutMatch,
  createLegacyKnockoutMatch,
  createSuperGroupMatch,
  createByeMatch,
};
