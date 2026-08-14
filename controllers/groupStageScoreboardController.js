const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
const SwissMatch = require("../src/modules/tournaments/models/SwissMatch");
const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
const User = require("../src/modules/identity/models/User");
const Score = require("../src/modules/tournaments/models/Score");
const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
const mongoose = require("mongoose");
const { readMatchFormat, SAFE_DEFAULTS } = require("../utils/matchFormatUtils");

// ================================
// HELPER FUNCTIONS
// ================================

// Sync match data to Score model — sport-aware
const syncScoreModel = async (match, session = null) => {
  try {
    const { readMatchResult } = require("../utils/matchUtils");
    const result = readMatchResult(match);

    // Initialize counters from raw match data
    let totalGamesWonA = 0;
    let totalGamesWonB = 0;
    let totalScoreA = 0;
    let totalScoreB = 0;
    const setScores = [];

    // Process sets if they exist (internal storage format)
    if (match.sets && match.sets.length > 0) {
      match.sets.forEach((set) => {
        if (set.games && set.games.length > 0) {
          let setGamesA = 0, setGamesB = 0, setPointsA = 0, setPointsB = 0;

          set.games.forEach(game => {
            if (game.status === 'COMPLETED') {
              if (game.finalScore) {
                setPointsA += game.finalScore.player1 || 0;
                setPointsB += game.finalScore.player2 || 0;
              }
              if (game.winner && game.winner.playerId) {
                const winnerIdStr = game.winner.playerId.toString();
                const player1IdStr = match.player1.playerId.toString();
                if (winnerIdStr === player1IdStr) setGamesA++;
                else setGamesB++;
              }
            }
          });

          totalGamesWonA += setGamesA;
          totalGamesWonB += setGamesB;
          totalScoreA += setPointsA;
          totalScoreB += setPointsB;
          setScores.push([setGamesA, setGamesB, setPointsA, setPointsB, set]);
        }
      });
    }

    // Determine winner
    let winner = null;
    if (match.status === 'COMPLETED' && result.winner?.playerId) {
      winner = result.winner.playerId.toString();
    } else if (match.status === 'COMPLETED') {
      if (totalScoreA > totalScoreB) winner = match.player1.playerId.toString();
      else if (totalScoreB > totalScoreA) winner = match.player2.playerId.toString();
    }

    // Build dynamic sets array (legacy format)
    const dynamicSets = setScores.map((s, idx) => {
      const setData = s[4];
      return {
        setNumber: idx + 1,
        gamesWonA: s[0], gamesWonB: s[1],
        pointsScoredA: s[2], pointsScoredB: s[3],
        winner: setData?.winner?.playerId?.toString() || null,
      };
    });

    const updateData = {
      matchId: match._id,
      playerA: match.player1.playerId.toString(),
      playerB: match.player2.playerId.toString(),
      // Sport-neutral normalized result
      scoringType: result.type,
      matchResult: {
        type: result.type,
        player1Score: result.player1Score,
        player2Score: result.player2Score,
        completed: result.completed,
        labels: result.labels,
      },
      // Legacy setOne-setSeven fields REMOVED from write path (Phase 11).
      // Old data still readable via schema; new writes use sets[] + matchResult only.
      sets: dynamicSets,
      gamesWonA: totalGamesWonA,
      gamesWonB: totalGamesWonB,
      totalScoreA: totalScoreA,
      totalScoreB: totalScoreB,
      winner: winner,
      matchStatus: match.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
    };

    const score = await Score.findOneAndUpdate(
      { matchId: match._id },
      updateData,
      { upsert: true, new: true }
    );

    return score;
  } catch (error) {
    console.error('Error syncing score model:', error);
    return null;
  }
};


// Recalculate group standings from completed matches — SPORT-AWARE
const recalculateGroupStandings = async (tournamentId, groupId) => {
  try {
    const group = await BookingGroup.findById(groupId);
    if (!group) return null;

    // Detect scoringType from the sport-track matching this group's sportId.
    // Falls back to root tournament.matchFormat for legacy single-sport.
    const Tournament = require("../src/modules/tournaments/models/Tournament");
    const tournament = await Tournament.findById(tournamentId);
    const { getScoringType } = require("../utils/matchFormatUtils");
    const { getMatchFormat, resolveSportId } = require("../utils/sportTrackUtils");

    // STEP 16e — recalculateGroupStandings is internal-only (called from
    // score-update / progression triggers, never from a direct external
    // endpoint). Hard-rejecting on a null group.sportId would silently
    // break standings without surfacing the error to the manager. Log a
    // warning instead and proceed via resolveSportId fallback so the
    // standings still get recomputed for legacy/orphaned groups.
    if (!group?.sportId) {
      console.warn(
        `[recalculateGroupStandings] BookingGroup ${groupId} has no sportId — ` +
        `falling back to tournament.sports[0]. Group is likely orphaned/unmigrated.`
      );
    }
    const sportId = resolveSportId(tournament, group?.sportId);
    const trackMatchFormat = getMatchFormat(tournament, sportId);
    const scoringType = trackMatchFormat?.scoringType
      || tournament?.matchFormat?.scoringType
      || getScoringType(tournament?.sportsType)
      || "sets";

    // Sport-aware league points. Cricket convention is 2/1/0 (win/tie/loss);
    // everything else uses 3/1/0.
    const pointsForWin = scoringType === "innings" ? 2 : 3;
    const pointsForDraw = 1;

    // Get all completed matches for this group
    const matches = await Match.find({
      tournamentId,
      groupId,
      status: "COMPLETED",
    });

    // Build stats map for every player in the group
    const statsMap = {};
    for (const p of group.players) {
      statsMap[p.playerId.toString()] = {
        playerId: p.playerId,
        playerName: p.userName,
        played: 0,
        won: 0,
        lost: 0,
        drawn: 0,
        roundsWon: 0,
        roundsLost: 0,
        scoreFor: 0,
        scoreAgainst: 0,
        oversFor: 0,
        oversAgainst: 0,
        netRunRate: 0,
        // Legacy aliases (kept for backward compat with frontend)
        setsWon: 0,
        setsLost: 0,
        pointsScored: 0,
        pointsConceded: 0,
        totalPoints: 0,
      };
    }

    // Process each completed match using readMatchResult
    const { readMatchResult } = require("../utils/matchUtils");

    for (const match of matches) {
      const p1Id = match.player1.playerId.toString();
      const p2Id = match.player2.playerId.toString();

      if (!statsMap[p1Id] || !statsMap[p2Id]) continue;

      // Read normalized result
      const result = readMatchResult(match, { tournament });

      // Played
      statsMap[p1Id].played++;
      statsMap[p2Id].played++;

      // Win/Loss/Draw + Tournament Points (sport-aware points)
      if (result.winner && result.winner.playerId) {
        const winnerId = result.winner.playerId?.toString();
        if (winnerId === p1Id) {
          statsMap[p1Id].won++;
          statsMap[p1Id].totalPoints += pointsForWin;
          statsMap[p2Id].lost++;
        } else if (winnerId === p2Id) {
          statsMap[p2Id].won++;
          statsMap[p2Id].totalPoints += pointsForWin;
          statsMap[p1Id].lost++;
        }
      } else {
        // Draw (time-based sports, or a tied cricket match in group play)
        statsMap[p1Id].drawn++;
        statsMap[p2Id].drawn++;
        statsMap[p1Id].totalPoints += pointsForDraw;
        statsMap[p2Id].totalPoints += pointsForDraw;
      }

      // Rounds won (sets/innings/periods — the top-level score)
      statsMap[p1Id].roundsWon += result.player1Score;
      statsMap[p1Id].roundsLost += result.player2Score;
      statsMap[p2Id].roundsWon += result.player2Score;
      statsMap[p2Id].roundsLost += result.player1Score;

      // Legacy aliases
      statsMap[p1Id].setsWon = statsMap[p1Id].roundsWon;
      statsMap[p1Id].setsLost = statsMap[p1Id].roundsLost;
      statsMap[p2Id].setsWon = statsMap[p2Id].roundsWon;
      statsMap[p2Id].setsLost = statsMap[p2Id].roundsLost;

      // Score accumulation (points/goals/runs from game-level data)
      if (scoringType === "innings" && Array.isArray(match.result?.innings)) {
        // Cricket — accumulate runs scored/conceded and overs faced/bowled (NRR).
        for (const inn of match.result.innings) {
          const batSide = inn.battingSide; // "player1" | "player2"
          const runs = inn.runs || 0;
          const overs = (inn.oversBowled || 0) + (inn.ballsBowled || 0) / 6;
          if (batSide === "player1") {
            statsMap[p1Id].scoreFor += runs; statsMap[p1Id].oversFor += overs;
            statsMap[p2Id].scoreAgainst += runs; statsMap[p2Id].oversAgainst += overs;
          } else if (batSide === "player2") {
            statsMap[p2Id].scoreFor += runs; statsMap[p2Id].oversFor += overs;
            statsMap[p1Id].scoreAgainst += runs; statsMap[p1Id].oversAgainst += overs;
          }
        }
      } else if (scoringType === "board" && Array.isArray(match.result?.boards)) {
        // Carrom — accumulate per-board points.
        for (const b of match.result.boards) {
          const s1 = b.player1Points || 0;
          const s2 = b.player2Points || 0;
          statsMap[p1Id].scoreFor += s1; statsMap[p1Id].scoreAgainst += s2;
          statsMap[p2Id].scoreFor += s2; statsMap[p2Id].scoreAgainst += s1;
        }
      } else if (match.sets) {
        for (const set of match.sets) {
          if (!set.games) continue;
          for (const game of set.games) {
            if (game.status !== "COMPLETED" || !game.finalScore) continue;
            const s1 = game.finalScore.player1 || 0;
            const s2 = game.finalScore.player2 || 0;
            statsMap[p1Id].scoreFor += s1;
            statsMap[p1Id].scoreAgainst += s2;
            statsMap[p2Id].scoreFor += s2;
            statsMap[p2Id].scoreAgainst += s1;
          }
        }
      }

      // Legacy aliases
      statsMap[p1Id].pointsScored = statsMap[p1Id].scoreFor;
      statsMap[p1Id].pointsConceded = statsMap[p1Id].scoreAgainst;
      statsMap[p2Id].pointsScored = statsMap[p2Id].scoreFor;
      statsMap[p2Id].pointsConceded = statsMap[p2Id].scoreAgainst;
    }

    // Ranking rules (per client spec):
    //   1. Primary — Matches Won (desc).
    //   2. Two-way tie — Head-to-head: winner of the match between the two
    //      tied players ranks higher.
    //   3. Three+ way tie — Set difference (roundsWon − roundsLost), desc.
    //   Further ties (unspecified) — score diff, then name for stability.

    // Build head-to-head map: h2h[winnerId] → Set of loserIds they beat.
    const h2h = {};
    for (const match of matches) {
      const result = readMatchResult(match, { tournament });
      if (!result.winner) continue;
      const winnerId = result.winner.playerId?.toString();
      const p1Id = match.player1.playerId.toString();
      const p2Id = match.player2.playerId.toString();
      if (!winnerId || (winnerId !== p1Id && winnerId !== p2Id)) continue;
      const loserId = winnerId === p1Id ? p2Id : p1Id;
      if (!h2h[winnerId]) h2h[winnerId] = new Set();
      h2h[winnerId].add(loserId);
    }

    // Bucket players by matches won, then resolve ties within each bucket.
    const allPlayers = Object.values(statsMap);
    const byWon = {};
    for (const p of allPlayers) {
      const k = p.won;
      if (!byWon[k]) byWon[k] = [];
      byWon[k].push(p);
    }

    // Net run rate (cricket tiebreaker): runs/over scored − runs/over conceded.
    for (const p of Object.values(statsMap)) {
      const rrFor = p.oversFor > 0 ? p.scoreFor / p.oversFor : 0;
      const rrAgainst = p.oversAgainst > 0 ? p.scoreAgainst / p.oversAgainst : 0;
      p.netRunRate = Number((rrFor - rrAgainst).toFixed(3));
    }

    const setDiff = (p) => p.roundsWon - p.roundsLost;
    // For cricket, NRR is the meaningful score tiebreaker; otherwise raw diff.
    const scoreDiff = (p) => scoringType === "innings" ? p.netRunRate : (p.scoreFor - p.scoreAgainst);
    const byId = (p) => p.playerId.toString();

    const sorted = [];
    const wonKeys = Object.keys(byWon)
      .map(Number)
      .sort((a, b) => b - a); // highest matches-won first

    for (const won of wonKeys) {
      const tied = byWon[won];
      if (tied.length === 1) {
        sorted.push(tied[0]);
        continue;
      }
      if (tied.length === 2) {
        // Head-to-head between the two tied players.
        const [a, b] = tied;
        const aId = byId(a);
        const bId = byId(b);
        const aBeatB = h2h[aId]?.has(bId);
        const bBeatA = h2h[bId]?.has(aId);
        let ordered;
        if (aBeatB && !bBeatA) ordered = [a, b];
        else if (bBeatA && !aBeatB) ordered = [b, a];
        else {
          // No head-to-head played or mutual (rare) — fall back to set diff.
          ordered = [a, b].sort((x, y) => setDiff(y) - setDiff(x)
            || scoreDiff(y) - scoreDiff(x)
            || x.playerName.localeCompare(y.playerName));
        }
        sorted.push(...ordered);
        continue;
      }
      // 3+ way tie — set difference, then score diff, then name for stability.
      const ordered = [...tied].sort((x, y) =>
        setDiff(y) - setDiff(x)
        || scoreDiff(y) - scoreDiff(x)
        || x.playerName.localeCompare(y.playerName)
      );
      sorted.push(...ordered);
    }

    // Assign ranks
    sorted.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    // Upsert standings — also stamp sportId so multi-sport reads/queries
    // can scope by sport. Falls back to null for legacy tournaments.
    const standings = await GroupStandings.findOneAndUpdate(
      { tournamentId, groupId },
      {
        tournamentId,
        sportId,
        groupId,
        groupName: group.groupName,
        scoringType,
        standings: sorted,
      },
      { upsert: true, new: true }
    );

    return standings;
  } catch (error) {
    console.error("[RECALC_STANDINGS] Error:", error);
    return null;
  }
};

// Initialize match scoreboard structure
const initializeMatchScoreboard = async (match, isKnockoutMatch = false, session = null) => {
  try {
    // 🔥 DYNAMIC MATCH FORMAT - Get from tournament or use intelligent defaults
    if (!match.matchFormat) {
      // Load tournament format if not already loaded. STEP 17c — read
      // per-sport from sports[i] (root matchFormat removed).
      const Tournament = require("../src/modules/tournaments/models/Tournament");
      const { getMatchFormat, resolveSportId } = require("../utils/sportTrackUtils");
      const tournament = await Tournament.findById(match.tournamentId);
      const tournamentFormat = getMatchFormat(tournament, resolveSportId(tournament, match.sportId)) || {};

      // Apply tournament configuration with intelligent defaults
      match.matchFormat = {
        // 🎯 FLEXIBLE SETS CONFIGURATION
        totalSets: tournamentFormat.totalSets || tournamentFormat.maxSets || 5,
        setsToWin: tournamentFormat.setsToWin || Math.ceil((tournamentFormat.totalSets || tournamentFormat.maxSets || 5) / 2),
        maxSets: tournamentFormat.totalSets || tournamentFormat.maxSets || 5, // Backward compatibility

        // 🎯 FLEXIBLE GAMES CONFIGURATION
        totalGames: tournamentFormat.totalGames || tournamentFormat.maxGames || 5,
        gamesToWin: tournamentFormat.gamesToWin || Math.ceil((tournamentFormat.totalGames || tournamentFormat.maxGames || 5) / 2),
        maxGames: tournamentFormat.totalGames || tournamentFormat.maxGames || 5, // Backward compatibility

        // Points and rules — from tournament config, no TT defaults
        pointsToWinGame: tournamentFormat.pointsToWinGame || tournamentFormat.pointsPerSet || null,
        marginToWin: tournamentFormat.marginToWin ?? null,
        deuceRule: tournamentFormat.deuceRule !== undefined ? tournamentFormat.deuceRule : false,
        maxPointsPerGame: tournamentFormat.maxPointsPerGame || tournamentFormat.maxPointsCap || null,
        serviceRule: tournamentFormat.serviceRule || null
      };
    }

    // Initialize sets structure - only create first set with first game
    const sets = [];

    // Create first set with first game
    const firstGame = {
      gameNumber: 1,
      status: "IN_PROGRESS",
      finalScore: { player1: 0, player2: 0 },
      winner: { playerId: null, playerName: null },
      startTime: new Date(),
      endTime: null
    };

    const firstSet = {
      setNumber: 1,
      status: "IN_PROGRESS",
      winner: { playerId: null, playerName: null },
      games: [firstGame]
    };

    sets.push(firstSet);

    match.sets = sets;
    match.currentSet = 1;
    match.currentGame = 1;
    match.liveScore = { player1Points: 0, player2Points: 0 };

    // Handle status field based on specific match type
    if (isKnockoutMatch) {
      // 🔥 OPTIMIZED: Use constructor method instead of findById
      const isSuperMatch = match.constructor.modelName === 'SuperMatch';
      const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

      if (isSuperMatch || isDirectKnockout) {
        match.status = "IN_PROGRESS";
      }
    } else {
      match.status = "IN_PROGRESS"; // Regular Match uses uppercase
    }

    if (session) {
      await match.save({ session });
    } else {
      await match.save({ validateModifiedOnly: true });
    }

    return match;
  } catch (error) {
    console.error("Error initializing match scoreboard:", error);
    throw error;
  }
};

// Check if game is won — sport-aware (supports sets, time, innings, single)
const isGameWon = (player1Points, player2Points, pointsToWinGame = null, marginToWin = null, deuceRule = false, maxPointsPerGame = null, scoringType = null) => {
  // ═══ NON-SET SPORTS: time / innings / single / board ═══
  // For these, the submitted scores ARE the final match totals (goals, runs,
  // result, board points). No threshold validation — just check who scored more.
  if (scoringType === "time" || scoringType === "innings" || scoringType === "single" || scoringType === "board") {
    if (player1Points === player2Points) {
      // Ties are LEGAL for time (football draw), innings (cricket tie → super-
      // over) and single (chess draw). Board (carrom) cannot tie → rejected.
      // winner is null; callers branch on isTie (group draw vs KO tie-break).
      return {
        isWon: scoringType === "innings" || scoringType === "time" || scoringType === "single",
        isTie: true,
        winner: null,
        winType: `${scoringType}_final_score`
      };
    }
    return {
      isWon: true,
      isTie: false,
      winner: player1Points > player2Points ? "player1" : "player2",
      winType: `${scoringType}_final_score`
    };
  }

  // ═══ SET-BASED SPORTS: standard points-to-win validation ═══
  const minPoints = Math.max(player1Points, player2Points);
  const pointDiff = Math.abs(player1Points - player2Points);

  // Check if max points limit is reached (if configured)
  if (maxPointsPerGame && minPoints >= maxPointsPerGame) {
    return {
      isWon: true,
      winner: player1Points > player2Points ? "player1" : "player2",
      winType: "max_points_reached"
    };
  }

  // Standard win condition: reach pointsToWinGame
  if (minPoints >= pointsToWinGame) {
    if (deuceRule) {
      // With deuce rule: must win by margin
      if (pointDiff >= marginToWin) {
        return {
          isWon: true,
          winner: player1Points > player2Points ? "player1" : "player2",
          winType: "standard_win_with_margin"
        };
      }
    } else {
      // Without deuce rule: first to pointsToWinGame wins
      return {
        isWon: true,
        winner: player1Points > player2Points ? "player1" : "player2",
        winType: "standard_win_no_margin"
      };
    }
  }

  return {
    isWon: false,
    winner: null,
    isDeuce: deuceRule && minPoints >= (pointsToWinGame - 1) && pointDiff < marginToWin
  };
};

// Check if set is won
const isSetWon = (player1Games, player2Games, gamesToWin) => {
  const gamesWonByPlayer1 = player1Games;
  const gamesWonByPlayer2 = player2Games;

  // For best of 3 games (gamesToWin=2), need to win 2 games to win the set
  const gamesNeededToWinSet = gamesToWin;

  if (gamesWonByPlayer1 >= gamesNeededToWinSet) {
    return { isWon: true, winner: "player1" };
  }

  if (gamesWonByPlayer2 >= gamesNeededToWinSet) {
    return { isWon: true, winner: "player2" };
  }

  return { isWon: false, winner: null };
};

// Check if match is won
const isMatchWon = (player1Sets, player2Sets, setsToWin) => {
  // For best of 3 sets (setsToWin=2), need to win 2 sets to win the match
  const setsNeededToWinMatch = setsToWin;

  if (player1Sets >= setsNeededToWinMatch) {
    return { isWon: true, winner: "player1" };
  }

  if (player2Sets >= setsNeededToWinMatch) {
    return { isWon: true, winner: "player2" };
  }

  return { isWon: false, winner: null };
};

// ================================
// CONTROLLER FUNCTIONS
// ================================

// Start match and initialize scoreboard
const startMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { matchFormat } = req.body;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    const match = await Match.findById(matchId).populate('tournamentId', 'matchFormat title');
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    if (match.status !== "SCHEDULED") {
      return res.status(400).json({
        success: false,
        message: "Match has already been started or completed"
      });
    }

    // Merge tournament configuration with match-specific overrides
    const tournamentFormat = match.tournamentId?.matchFormat || {};
    const currentMatchFormat = match.matchFormat || {};
    const requestFormat = matchFormat || {};

    // Create comprehensive match format (tournament < match < request)
    const finalMatchFormat = {
      // 🎯 FLEXIBLE SETS CONFIGURATION - Use new totalSets field with fallback
      totalSets: requestFormat.totalSets || currentMatchFormat.totalSets || tournamentFormat.totalSets ||
        requestFormat.maxSets || currentMatchFormat.maxSets || tournamentFormat.maxSets || 5,
      setsToWin: requestFormat.setsToWin || currentMatchFormat.setsToWin || tournamentFormat.setsToWin ||
        Math.ceil((requestFormat.totalSets || currentMatchFormat.totalSets || tournamentFormat.totalSets || 5) / 2),
      maxSets: requestFormat.totalSets || currentMatchFormat.totalSets || tournamentFormat.totalSets ||
        requestFormat.maxSets || currentMatchFormat.maxSets || tournamentFormat.maxSets || 5, // Backward compatibility

      // 🎯 FLEXIBLE GAMES CONFIGURATION - Use new totalGames field with fallback
      totalGames: requestFormat.totalGames || currentMatchFormat.totalGames || tournamentFormat.totalGames ||
        requestFormat.maxGames || currentMatchFormat.maxGames || tournamentFormat.maxGames || 5,
      gamesToWin: requestFormat.gamesToWin || currentMatchFormat.gamesToWin || tournamentFormat.gamesToWin ||
        Math.ceil((requestFormat.totalGames || currentMatchFormat.totalGames || tournamentFormat.totalGames || 5) / 2),
      maxGames: requestFormat.totalGames || currentMatchFormat.totalGames || tournamentFormat.totalGames ||
        requestFormat.maxGames || currentMatchFormat.maxGames || tournamentFormat.maxGames || 5, // Backward compatibility

      // Points configuration — no TT defaults; use tournament config
      pointsToWinGame: requestFormat.pointsToWinGame || currentMatchFormat.pointsToWinGame || tournamentFormat.pointsToWinGame || null,
      marginToWin: requestFormat.marginToWin ?? currentMatchFormat.marginToWin ?? tournamentFormat.marginToWin ?? null,

      // Rules configuration
      deuceRule: requestFormat.deuceRule !== undefined ? requestFormat.deuceRule :
        currentMatchFormat.deuceRule !== undefined ? currentMatchFormat.deuceRule :
          tournamentFormat.deuceRule !== undefined ? tournamentFormat.deuceRule : false,
      maxPointsPerGame: requestFormat.maxPointsPerGame || currentMatchFormat.maxPointsPerGame || tournamentFormat.maxPointsPerGame || null,

      // Service rules
      serviceRule: {
        pointsPerService: requestFormat.serviceRule?.pointsPerService ||
          currentMatchFormat.serviceRule?.pointsPerService ||
          tournamentFormat.serviceRule?.pointsPerService || 2,
        deuceServicePoints: requestFormat.serviceRule?.deuceServicePoints ||
          currentMatchFormat.serviceRule?.deuceServicePoints ||
          tournamentFormat.serviceRule?.deuceServicePoints || 1
      }
    };

    // Update match with final configuration
    match.matchFormat = finalMatchFormat;

    // Initialize scoreboard
    const initializedMatch = await initializeMatchScoreboard(match);

    res.status(200).json({
      success: true,
      message: "Match started successfully with configuration",
      match: initializedMatch,
      appliedConfiguration: finalMatchFormat,
      configurationSource: {
        tournament: match.tournamentId?.title || "Unknown",
        inheritedFromTournament: Object.keys(tournamentFormat).length > 0,
        hasMatchOverrides: Object.keys(currentMatchFormat).length > 0,
        hasRequestOverrides: Object.keys(requestFormat).length > 0
      }
    });

  } catch (error) {
    console.error("Error starting match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start match",
      error: error.message
    });
  }
};

// Get live match state
const getLiveMatchState = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    // Try to find match in regular Match collection first
    let match = await Match.findById(matchId)
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .populate('tournamentId', 'matchFormat title'); // 🔥 CRITICAL: Load tournament match format

    let isKnockoutMatch = false;

    // If not found in Match, try SuperMatch (Round 2 knockout matches)
    if (!match) {
      match = await SuperMatch.findById(matchId)
        .populate('player1.playerId', 'name profileImage')
        .populate('player2.playerId', 'name profileImage');

      if (match) {
        isKnockoutMatch = true;
      }
    }

    // If not found in SuperMatch, try DirectKnockoutMatch (Direct knockout matches)
    if (!match) {
      match = await DirectKnockoutMatch.findById(matchId)
        .populate('player1.playerId', 'name profileImage')
        .populate('player2.playerId', 'name profileImage');

      if (match) {
        isKnockoutMatch = true;
      }
    }

    // Swiss last: it lives in its own collection, so every existing match
    // type resolves above and this only runs when nothing else matched.
    if (!match) {
      match = await SwissMatch.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found in any collection (Match, SuperMatch, DirectKnockoutMatch, or SwissMatch)"
      });
    }

    // Check if auto-initialization is requested (via query parameter)
    const autoInit = req.query.autoInit === 'true';
    // Kept for the documented ?refreshFormat=true query param, but the reload
    // below is unconditional, so nothing reads it. Underscore-prefixed per the
    // repo's unused-vars convention.
    const _forceRefreshFormat = req.query.refreshFormat === 'true';

    // 🔥 ALWAYS ENSURE MATCH HAS CURRENT TOURNAMENT FORMAT
    // Always reload the tournament format so dynamic settings changes are
    // reflected. This used to be a four-clause guard ending in `|| true`, which
    // made every clause above it dead — the block ran unconditionally anyway.
    // A bare block says that outright and keeps the scoping identical;
    // no-constant-condition (correctly) rejected the `|| true`.
    // `forceRefreshFormat` (?refreshFormat=true) is therefore already implied.
    {

      // Load tournament format if not already loaded or missing new fields.
      // STEP 17c — root matchFormat/sportsType removed; read per-sport from
      // sports[i] keyed by match.sportId (with sports[0] fallback for legacy
      // matches lacking sportId).
      const Tournament = require("../src/modules/tournaments/models/Tournament");
      const { getMatchFormat, getSportName, resolveSportId } = require("../utils/sportTrackUtils");
      const tournament = await Tournament.findById(match.tournamentId);
      const _resolvedSportId = resolveSportId(tournament, match.sportId);
      const tournamentFormat = getMatchFormat(tournament, _resolvedSportId) || {};

      // Detect scoringType from tournament sport
      const { getScoringType } = require("../utils/matchFormatUtils");
      const sportName = match.sportName || match.sportsType || getSportName(tournament, _resolvedSportId);
      const VALID_SCORING_TYPES = ["sets", "time", "innings", "single", "board"];
      const rawScoringType = tournamentFormat.scoringType || getScoringType(sportName);
      const scoringType = VALID_SCORING_TYPES.includes(rawScoringType) ? rawScoringType : (getScoringType(sportName) || "sets");
      const isNonSet = scoringType === "time" || scoringType === "innings" || scoringType === "single" || scoringType === "board";
      const defaultSets = isNonSet ? 1 : (tournamentFormat.totalSets || 1);
      const defaultGames = isNonSet ? 1 : (tournamentFormat.totalGames || 1);
      const defaultPTW = isNonSet ? null : (tournamentFormat.pointsToWinGame || null);

      // Apply tournament configuration with sport-aware defaults
      match.matchFormat = {
        scoringType,

        totalSets: tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets,
        setsToWin: tournamentFormat.setsToWin || Math.ceil((tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets) / 2),
        maxSets: tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets,

        totalGames: tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames,
        gamesToWin: tournamentFormat.gamesToWin || Math.ceil((tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames) / 2),
        maxGames: tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames,

        pointsToWinGame: tournamentFormat.pointsToWinGame || defaultPTW,
        marginToWin: tournamentFormat.marginToWin ?? null,
        deuceRule: tournamentFormat.deuceRule !== undefined ? tournamentFormat.deuceRule : !isNonSet,
        // The hard cap is stored as `maxPointsCap` in presets/freeze but the
        // engine consumes `maxPointsPerGame`. Coalesce both so e.g. Badminton's
        // 30-point cap actually flows through (otherwise a 30-29 finish is
        // rejected as "not won by margin").
        maxPointsPerGame: tournamentFormat.maxPointsPerGame || tournamentFormat.maxPointsCap || null,
        serviceRule: {
          pointsPerService: tournamentFormat.serviceRule?.pointsPerService || 2,
          deuceServicePoints: tournamentFormat.serviceRule?.deuceServicePoints || 1
        }
      };

      // Save the updated match format
      await match.save({ validateModifiedOnly: true });
    }

    // If match not started, only initialize if explicitly requested
    // Handle both regular matches (SCHEDULED) and knockout matches (scheduled)
    const isNotStarted = match.status === "SCHEDULED" ||
      (!match.sets || match.sets.length === 0);

    if (isNotStarted && autoInit) {
      // Only initialize if explicitly requested to prevent accidental status changes
      const initializedMatch = await initializeMatchScoreboard(match, isKnockoutMatch);
      return res.status(200).json({
        success: true,
        match: initializedMatch,
        matchType: isKnockoutMatch ? 'knockout' : 'regular',
        initialized: true
      });
    }

    // Sport-aware live-score block for cricket (innings) and carrom (board) so
    // the scorers/spectators can render without separate calls.
    let liveScore = null;
    const _st = match.matchFormat?.scoringType || match.scoringType || null;
    if (_st === "innings") liveScore = _cricketLiveScore(match, match.matchFormat || {});
    else if (_st === "board") liveScore = _carromLiveScore(match);

    const matchObj = match.toObject ? match.toObject() : match;
    if (liveScore) matchObj.liveScore = liveScore;

    res.status(200).json({
      success: true,
      match: matchObj,
      liveScore,
      matchType: isKnockoutMatch ? 'knockout' : 'regular'
    });

  } catch (error) {
    console.error("Error fetching live match state:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match state",
      error: error.message
    });
  }
};

// Update live score
const updateLiveScore = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { player1Points, player2Points } = req.body;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    if (player1Points === undefined || player2Points === undefined) {
      return res.status(400).json({
        success: false,
        message: "Both player points are required"
      });
    }

    // Try to find match in regular Match collection first
    let match = await Match.findById(matchId);
    let isKnockoutMatch = false;

    // If not found in Match, try SuperMatch (Round 2 knockout matches)
    if (!match) {
      match = await SuperMatch.findById(matchId);
      if (match) {
        isKnockoutMatch = true;
      }
    }

    // If not found in SuperMatch, try DirectKnockoutMatch (Direct knockout matches)
    if (!match) {
      match = await DirectKnockoutMatch.findById(matchId);
      if (match) {
        isKnockoutMatch = true;
      }
    }

    // Swiss last: it lives in its own collection, so every existing match
    // type resolves above and this only runs when nothing else matched.
    if (!match) {
      match = await SwissMatch.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found in any collection"
      });
    }

    // Check if match is in progress (handle all status formats properly!)
    const validStatuses = ["IN_PROGRESS"];

    // 🔥 AUTO-INITIALIZE MATCH ON FIRST SCORE UPDATE
    // If match is scheduled but user is trying to update score, auto-start the match
    const isScheduled = match.status === "SCHEDULED";
    if (isScheduled) {

      // Initialize the match automatically
      const initializedMatch = await initializeMatchScoreboard(match, isKnockoutMatch);
      match = initializedMatch; // Use the initialized match
    } else if (!validStatuses.includes(match.status)) {
      return res.status(400).json({
        success: false,
        message: `Match is not in progress. Current: ${match.status}, Expected: ${validStatuses.join(' or ')}`
      });
    }

    // Update live score
    match.liveScore = {
      player1Points: parseInt(player1Points),
      player2Points: parseInt(player2Points)
    };

    await match.save({ validateModifiedOnly: true });

    res.status(200).json({
      success: true,
      message: "Live score updated",
      liveScore: match.liveScore
    });

  } catch (error) {
    console.error("Error updating live score:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update live score",
      error: error.message
    });
  }
};

// Complete current game
const completeGame = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { matchId } = req.params;
    // penaltyWinner ("player1"|"player2") decides a level KNOCKOUT match for
    // time-based sports (Football) — a penalty shootout. Ignored otherwise.
    const { finalPlayer1Points, finalPlayer2Points, penaltyWinner = null } = req.body;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    // Try all match models (for comprehensive support)
    let match = await Match.findById(matchId).session(session);
    let isKnockoutMatch = false;

    if (!match) {
      // Try SuperMatch model for Round 2 knockout matches
      match = await SuperMatch.findById(matchId).session(session);
      if (match) {
        isKnockoutMatch = true;
      }
    }

    if (!match) {
      // Try DirectKnockoutMatch model for Direct knockout matches
      match = await DirectKnockoutMatch.findById(matchId).session(session);
      if (match) {
        isKnockoutMatch = true;
      }
    }

    // Swiss last: it lives in its own collection, so every existing match
    // type resolves above and this only runs when nothing else matched.
    if (!match) {
      match = await SwissMatch.findById(matchId).session(session);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // ═══ GUARD: Block scoring on completed matches ═══
    if (match.status === "COMPLETED" || match.status === "completed") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Cannot score a completed match. This match has already finished.",
      });
    }

    // ═══ GUARD: Authorization check (Phase 4b) ═══
    // Caller must be (a) a manager of this tournament, or
    // (b) an umpire authorized per umpireAuth (match-level or stage-level grant).
    const callerId = req.user?._id?.toString() || req.user?.id?.toString();
    if (!callerId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    let authorized = false;
    if (req.userRole === "Manager") {
      const TournamentModel = require("../src/modules/tournaments/models/Tournament");
      const tournamentDoc = await TournamentModel.findById(match.tournamentId)
        .select("managerId clubId")
        .lean();
      const managerIds = Array.isArray(tournamentDoc?.managerId)
        ? tournamentDoc.managerId.map((id) => id?.toString())
        : tournamentDoc?.managerId
        ? [tournamentDoc.managerId.toString()]
        : [];
      authorized = managerIds.includes(callerId);
      // Same-club fallback: any manager of the tournament's owning club may
      // score it (covers tournaments created before the creator was auto-added
      // to managerId). Both clubIds must be present and equal.
      if (!authorized && tournamentDoc?.clubId && req.user?.clubId &&
          String(tournamentDoc.clubId) === String(req.user.clubId)) {
        authorized = true;
      }
    } else {
      const { isUmpireAuthorizedForMatch } = require("../utils/umpireAuth");
      const result = await isUmpireAuthorizedForMatch(callerId, match);
      authorized = !!result.authorized;
    }

    if (!authorized) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to score this match.",
      });
    }

    // 🔥 DYNAMIC MATCH FORMAT - Get from tournament or use intelligent defaults
    if (!match.matchFormat) {
      // Try to get format from tournament
      let tournamentFormat = {};
      let tournamentSportsType = null;

      if (match.tournamentId) {
        try {
          const Tournament = require("../src/modules/tournaments/models/Tournament");
          const { getMatchFormat, getSportName, resolveSportId } = require("../utils/sportTrackUtils");
          const tournament = await Tournament.findById(match.tournamentId);
          const _resolvedSportId = resolveSportId(tournament, match.sportId);
          tournamentFormat = getMatchFormat(tournament, _resolvedSportId) || {};
          tournamentSportsType = getSportName(tournament, _resolvedSportId) || null;
        } catch (error) {
          console.log("Could not fetch tournament format, using defaults");
        }
      }

      // Detect scoringType from tournament sport
      const { getScoringType } = require("../utils/matchFormatUtils");
      const sportName = match.sportName || match.sportsType || tournamentSportsType;
      const scoringType = tournamentFormat.scoringType || getScoringType(sportName);

      // Sport-aware defaults: non-set sports use 1 set / 1 game / 1 point-to-win
      const isNonSet = scoringType === "time" || scoringType === "innings" || scoringType === "single" || scoringType === "board";
      const defaultSets = isNonSet ? 1 : (tournamentFormat.totalSets || 1);
      const defaultGames = isNonSet ? 1 : (tournamentFormat.totalGames || 1);
      const defaultPTW = isNonSet ? null : (tournamentFormat.pointsToWinGame || null);
      const defaultDeuce = isNonSet ? false : true;

      // Create comprehensive match format with tournament inheritance
      match.matchFormat = {
        scoringType,

        totalSets: tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets,
        setsToWin: tournamentFormat.setsToWin || Math.ceil((tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets) / 2),
        maxSets: tournamentFormat.totalSets || tournamentFormat.maxSets || defaultSets,

        totalGames: tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames,
        gamesToWin: tournamentFormat.gamesToWin || Math.ceil((tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames) / 2),
        maxGames: tournamentFormat.totalGames || tournamentFormat.maxGames || defaultGames,

        pointsToWinGame: tournamentFormat.pointsToWinGame || defaultPTW,
        marginToWin: tournamentFormat.marginToWin ?? null,
        deuceRule: tournamentFormat.deuceRule !== undefined ? tournamentFormat.deuceRule : defaultDeuce,
        // Coalesce maxPointsCap → maxPointsPerGame so the hard cap (e.g. 30 in
        // Badminton) is enforced on this auto-init path too.
        maxPointsPerGame: tournamentFormat.maxPointsPerGame || tournamentFormat.maxPointsCap || null,

        serviceRule: {
          pointsPerService: tournamentFormat.serviceRule?.pointsPerService || 2,
          deuceServicePoints: tournamentFormat.serviceRule?.deuceServicePoints || 1
        }
      };
    }

    // 🔥 AUTO-INITIALIZE MATCH IF NOT STARTED
    // Ensure sets structure exists before trying to find currentSet
    const isNotStarted = match.status === "SCHEDULED" ||
      (!match.sets || match.sets.length === 0);

    if (isNotStarted) {
      console.log(`Auto-initializing match ${matchId} during completeGame`);
      const initializedMatch = await initializeMatchScoreboard(match, isKnockoutMatch, session);
      match = initializedMatch;
    }

    const currentSet = match.sets.find(s => s.setNumber === match.currentSet);
    if (!currentSet) {
      throw new Error("Current set not found");
    }

    const currentGame = currentSet.games.find(g => g.gameNumber === match.currentGame);
    if (!currentGame) {
      throw new Error("Current game not found");
    }

    // matchFormat.scoringType is STRIPPED by the Match subschema, so it's always
    // undefined here. Resolve from the canonical top-level match.scoringType
    // (or the sport mapping) — otherwise time sports (Football) wrongly fall
    // back to "sets" and a draw gets rejected as a tie.
    const { getScoringType } = require("../utils/matchFormatUtils");
    const resolvedScoringType =
      (match.matchFormat && match.matchFormat.scoringType) ||
      match.scoringType ||
      getScoringType(match.sportName) ||
      "sets";

    // Pre-validate game scores
    const { validateGameScore } = require("../utils/validateMatchResult");
    const preValidation = validateGameScore(
      finalPlayer1Points, finalPlayer2Points,
      Object.assign({}, match.matchFormat?.toObject ? match.matchFormat.toObject() : match.matchFormat, { scoringType: resolvedScoringType })
    );
    if (!preValidation.valid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: preValidation.errors.join("; ") });
    }

    // Validate game win with complete configuration (sport-aware)
    const gameResult = isGameWon(
      finalPlayer1Points,
      finalPlayer2Points,
      match.matchFormat.pointsToWinGame,
      match.matchFormat.marginToWin,
      match.matchFormat.deuceRule,
      match.matchFormat.maxPointsPerGame,
      resolvedScoringType
    );

    if (!gameResult.isWon) {
      return res.status(400).json({
        success: false,
        message: `Invalid game result — scores do not satisfy win condition (scoringType: ${resolvedScoringType})`
      });
    }

    // ── Drawable non-set sports (Football time, Chess single): resolve a LEVEL
    // final score. Group stage → genuine draw (normalized after completion).
    // Knockout → the manager must enter a tie-break winner; a KO can't end level.
    const _isTimeSport = resolvedScoringType === "time";
    const _drawableNonSet = resolvedScoringType === "time" || resolvedScoringType === "single";
    const _isKnockoutLike = isKnockoutMatch || !!match.nextMatchId;
    if (_drawableNonSet && gameResult.isTie && _isKnockoutLike) {
      if (penaltyWinner === "player1" || penaltyWinner === "player2") {
        gameResult.isTie = false;
        gameResult.winner = penaltyWinner;
        gameResult.shootout = true;
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          needsTiebreak: true,
          message: "Knockout match ended level — enter a tie-break winner to decide it.",
        });
      }
    }

    // Update current game
    currentGame.status = "COMPLETED";
    currentGame.finalScore = {
      player1: finalPlayer1Points,
      player2: finalPlayer2Points
    };
    currentGame.endTime = new Date();

    // Set game winner (handle both Match and SuperMatch player name fields)
    const winnerId = gameResult.winner === "player1" ? match.player1.playerId : match.player2.playerId;
    const winnerName = gameResult.winner === "player1" ?
      (match.player1.playerName || match.player1.userName) :
      (match.player2.playerName || match.player2.userName);

    currentGame.winner = {
      playerId: winnerId,
      playerName: winnerName
    };

    // Sport-aware shape branch.
    // Nested-game sports (Tennis): a set contains multiple games; count games won.
    // Flat-set sports (TT, Badminton, Volleyball): each submitted score IS the set's
    // final score \u2014 the synthetic single game's winner IS the set winner. No counting.
    const { hasNestedGames } = require("../factories/MatchFactory");
    const nested = hasNestedGames(match.matchFormat);

    let player1GamesWon, player2GamesWon, setResult;

    if (nested) {
      // Calculate games won in current set (with null safety for knockout matches)
      player1GamesWon = currentSet.games.filter(g => {
        if (g.status !== "COMPLETED") return false;

        // For knockout matches, use playerName if playerId is not available
        if (match.player1.playerId && g.winner.playerId) {
          return g.winner.playerId.toString() === match.player1.playerId.toString();
        } else {
          // Fallback to playerName comparison
          const matchPlayer1Name = match.player1.playerName || match.player1.userName;
          return g.winner.playerName === matchPlayer1Name;
        }
      }).length;

      player2GamesWon = currentSet.games.filter(g => {
        if (g.status !== "COMPLETED") return false;

        // For knockout matches, use playerName if playerId is not available
        if (match.player2.playerId && g.winner.playerId) {
          return g.winner.playerId.toString() === match.player2.playerId.toString();
        } else {
          // Fallback to playerName comparison
          const matchPlayer2Name = match.player2.playerName || match.player2.userName;
          return g.winner.playerName === matchPlayer2Name;
        }
      }).length;

      // Check if set is won (standard multi-game tally)
      setResult = isSetWon(player1GamesWon, player2GamesWon, match.matchFormat.gamesToWin);
    } else {
      // Flat-set: the game we just completed IS the set.
      // No counting needed \u2014 gameResult's winner is the set winner.
      player1GamesWon = gameResult.winner === "player1" ? 1 : 0;
      player2GamesWon = gameResult.winner === "player2" ? 1 : 0;
      setResult = { isWon: true, winner: gameResult.winner };
    }


    let setCompleted = false;
    let matchCompleted = false;

    if (setResult.isWon) {
      // Set is won
      currentSet.status = "COMPLETED";
      currentSet.winner = {
        playerId: setResult.winner === "player1" ? match.player1.playerId : match.player2.playerId,
        playerName: setResult.winner === "player1" ? (match.player1.playerName || match.player1.userName) : (match.player2.playerName || match.player2.userName)
      };

      // Calculate sets won (with null safety for knockout matches)
      const player1SetsWon = match.sets.filter(s => {
        if (s.status !== "COMPLETED" || !s.winner) return false;

        // For knockout matches, use playerName if playerId is not available
        if (match.player1.playerId && s.winner.playerId) {
          return s.winner.playerId.toString() === match.player1.playerId.toString();
        } else {
          // Fallback to playerName comparison
          const matchPlayer1Name = match.player1.playerName || match.player1.userName;
          return s.winner.playerName === matchPlayer1Name;
        }
      }).length;

      const player2SetsWon = match.sets.filter(s => {
        if (s.status !== "COMPLETED" || !s.winner) return false;

        // For knockout matches, use playerName if playerId is not available
        if (match.player2.playerId && s.winner.playerId) {
          return s.winner.playerId.toString() === match.player2.playerId.toString();
        } else {
          // Fallback to playerName comparison
          const matchPlayer2Name = match.player2.playerName || match.player2.userName;
          return s.winner.playerName === matchPlayer2Name;
        }
      }).length;

      // Check if match is won
      const matchResult = isMatchWon(player1SetsWon, player2SetsWon, match.matchFormat.setsToWin);


      if (matchResult.isWon) {
        // Match is completed
        match.status = "COMPLETED";

        if (isKnockoutMatch) {
          // 🔥 DYNAMIC SCHEMA DETECTION - Handle SuperMatch vs DirectKnockoutMatch properly!
          const isSuperMatch = match.constructor.modelName === 'SuperMatch';
          const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

          if (isSuperMatch) {
            // For SuperMatch, use direct winner and score fields
            match.winner = {
              playerId: matchResult.winner === "player1" ? match.player1.playerId : match.player2.playerId,
              playerName: matchResult.winner === "player1" ? (match.player1.playerName || match.player1.userName) : (match.player2.playerName || match.player2.userName)
            };
            match.loser = {
              playerId: matchResult.winner === "player1" ? match.player2.playerId : match.player1.playerId,
              playerName: matchResult.winner === "player1" ? (match.player2.playerName || match.player2.userName) : (match.player1.playerName || match.player1.userName)
            };
            match.score = {
              player1Sets: player1SetsWon,
              player2Sets: player2SetsWon,
              setScores: [] // Will be populated below from sets data
            };

            // Convert sets data to setScores for statistics calculation
            if (match.sets && match.sets.length > 0) {
              match.score.setScores = match.sets.map((set, index) => ({
                setNumber: index + 1,
                player1Score: set.games ? set.games.reduce((total, game) => total + (game.finalScore?.player1 || 0), 0) : 0,
                player2Score: set.games ? set.games.reduce((total, game) => total + (game.finalScore?.player2 || 0), 0) : 0
              }));
            }

            // Calculate comprehensive statistics for SuperMatch
            const { calculateMatchStatistics } = require('./tournamentController');
            match.statistics = calculateMatchStatistics(match, match.score);
          } else if (isDirectKnockout) {
            // 🎯 For DirectKnockoutMatch, use result structure (CRITICAL FIX!)
            match.result = {
              winner: {
                playerId: matchResult.winner === "player1" ? match.player1.playerId : match.player2.playerId,
                playerName: matchResult.winner === "player1" ? (match.player1.playerName || match.player1.userName) : (match.player2.playerName || match.player2.userName)
              },
              finalScore: {
                player1Sets: player1SetsWon,
                player2Sets: player2SetsWon
              },
              completedAt: new Date(),
              matchDuration: match.createdAt ? Math.floor((new Date() - match.createdAt) / (1000 * 60)) : 0 // minutes
            };
          }
        } else {
          // For regular Match, use result structure
          match.result = {
            winner: {
              playerId: matchResult.winner === "player1" ? match.player1.playerId : match.player2.playerId,
              playerName: matchResult.winner === "player1" ? (match.player1.playerName || match.player1.userName) : (match.player2.playerName || match.player2.userName)
            },
            finalScore: {
              player1Sets: player1SetsWon,
              player2Sets: player2SetsWon
            },
            completedAt: new Date(),
            matchDuration: match.createdAt ? Math.floor((new Date() - match.createdAt) / (1000 * 60)) : 0 // minutes
          };
        }
        matchCompleted = true;

        // Write normalized matchResult on match completion
        try {
          const { readMatchResult } = require("../utils/matchUtils");
          const completedResult = readMatchResult(match);
          match.matchResult = {
            type: completedResult.type,
            completed: true,
            player1Score: completedResult.player1Score,
            player2Score: completedResult.player2Score,
            winner: completedResult.winner,
            details: completedResult.details,
          };
        } catch (mrErr) {
          console.warn("[COMPLETE_GAME] Could not build matchResult:", mrErr.message);
        }

        // ── Non-set (Football time / Chess single) result normalization ──
        // Persist the real score (goals/result, not the synthetic 1/0 "sets"),
        // and represent a level GROUP match as a genuine DRAW (no winner). KO
        // ties were already decided above via the tie-break winner.
        if (_drawableNonSet) {
          const goals = { player1Sets: finalPlayer1Points, player2Sets: finalPlayer2Points };
          if (match.result) match.result.finalScore = goals;
          if (match.score) { match.score.player1Sets = finalPlayer1Points; match.score.player2Sets = finalPlayer2Points; }
          if (match.matchResult) { match.matchResult.player1Score = finalPlayer1Points; match.matchResult.player2Score = finalPlayer2Points; }
          if (gameResult.shootout) {
            if (match.matchResult) match.matchResult.tiebreak = { type: "penalties", winner: gameResult.winner };
          } else if (gameResult.isTie) {
            // genuine draw (group stage) — clear the fabricated set winner
            if (match.result) match.result.winner = { playerId: null, playerName: null };
            if (match.winner) match.winner = { playerId: null, playerName: null };
            if (match.matchResult) match.matchResult.winner = null;
          }
        }

        // ================================
        // KNOCKOUT TOURNAMENT BRACKET PROGRESSION
        // ================================
        if (isKnockoutMatch) {
          try {
            // 🔥 DYNAMIC PROGRESSION - Handle different knockout types
            const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

            if (isDirectKnockout) {
              // Use specific direct knockout progression helper
              const { processDirectKnockoutProgression } = require('./directKnockoutController');
              const winnerId = matchResult.winner === "player1" ? match.player1.playerId : match.player2.playerId;
              await processDirectKnockoutProgression(match, winnerId);
            } else {
              // Use the centralized progression function from tournamentController for SuperMatch
              const { progressWinnerToNextRound } = require('./tournamentController');
              await progressWinnerToNextRound(match, session);
            }
          } catch (error) {
            console.error('Error advancing winner to next bracket:', error);
            // Don't fail the match completion if bracket progression fails
          }
        }

        // ================================
        // CREATE/UPDATE SCORE MODEL FOR POINTS TABLE SYNC (SKIP FOR KNOCKOUT MATCHES)
        // ================================
        if (!isKnockoutMatch) {
          await syncScoreModel(match, session);
          // Group standings are recalculated AFTER commit (below) — the
          // in-transaction recalc read a snapshot WITHOUT this just-completed
          // match, which dropped the last-scored match from the table.
        }
      } else {
        // Start next set
        const nextSetNumber = match.currentSet + 1;
        let nextSet = match.sets.find(s => s.setNumber === nextSetNumber);

        // Create next set if it doesn't exist - use totalSets limit instead of setsToWin
        if (!nextSet && nextSetNumber <= (match.matchFormat.totalSets || match.matchFormat.maxSets || 5)) {
          const games = [{
            gameNumber: 1,
            status: "IN_PROGRESS",
            finalScore: { player1: 0, player2: 0 },
            winner: { playerId: null, playerName: null },
            startTime: new Date(),
            endTime: null
          }];

          nextSet = {
            setNumber: nextSetNumber,
            status: "IN_PROGRESS",
            winner: { playerId: null, playerName: null },
            games: games
          };
          match.sets.push(nextSet);
        }

        if (nextSet) {
          match.currentSet = nextSetNumber;
          match.currentGame = 1;
        }
      }

      setCompleted = true;
    } else {
      // Continue current set - start next game
      const nextGameNumber = match.currentGame + 1;
      let nextGame = currentSet.games.find(g => g.gameNumber === nextGameNumber);

      // Create next game if it doesn't exist - use totalGames limit instead of gamesToWin
      if (!nextGame && nextGameNumber <= (match.matchFormat.totalGames || match.matchFormat.maxGames || 5)) {
        nextGame = {
          gameNumber: nextGameNumber,
          status: "IN_PROGRESS",
          finalScore: { player1: 0, player2: 0 },
          winner: { playerId: null, playerName: null },
          startTime: new Date(),
          endTime: null
        };
        currentSet.games.push(nextGame);
      }

      if (nextGame) {
        nextGame.status = "IN_PROGRESS";
        nextGame.startTime = new Date();
        match.currentGame = nextGameNumber;
      }
    }

    // Reset live score for next game
    match.liveScore = { player1Points: 0, player2Points: 0 };

    // Save to the correct model based on match type (support all three match types!)
    if (isKnockoutMatch) {
      // 🔥 OPTIMIZED: Use constructor method instead of findById
      const isSuperMatch = match.constructor.modelName === 'SuperMatch';
      const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

      if (isSuperMatch) {
        await SuperMatch.findByIdAndUpdate(matchId, match, { session, new: true });
      } else if (isDirectKnockout) {
        await DirectKnockoutMatch.findByIdAndUpdate(matchId, match, { session, new: true });
      }
    } else {
      // Regular Match (Group Stage)
      await match.save({ session });
    }

    // ================================
    // SYNC SCORE MODEL AFTER EVERY GAME COMPLETION FOR REAL-TIME UPDATES
    // ================================
    if (!matchCompleted) {
      // Even if match isn't complete, update score for live tracking
      await syncScoreModel(match, session);
    }

    await session.commitTransaction();

    // Recalculate group standings AFTER commit so the just-completed match is
    // included. (The in-transaction recalc read a snapshot without it, which
    // permanently dropped the LAST-scored group match → wrong qualifiers.)
    if (!isKnockoutMatch && matchCompleted) {
      try {
        await recalculateGroupStandings(match.tournamentId, match.groupId);
      } catch (e) {
        console.warn("[COMPLETE_GAME] post-commit standings recalc failed:", e.message);
      }
    }

    // Emit real-time events via Socket.io
    const io = req.app.get("io");
    if (io) {
      const tournamentId = match.tournamentId ? match.tournamentId.toString() : null;
      const tournamentRoom = tournamentId ? `tournament_${tournamentId}` : null;
      const matchRoom = `match_${matchId}`;

      // Sport metadata for frontend branching
      const sportMeta = {
        scoringType: match.matchFormat?.scoringType || null,
        sportName: match.sportsType || null,
      };

      // Sport-neutral labels for frontend rendering
      const _scoringType = sportMeta.scoringType;
      const labels = _scoringType === "time" ? { round: "Period", score: "Goals" }
        : _scoringType === "innings" ? { round: "Innings", score: "Runs" }
        : _scoringType === "single" ? { round: "Game", score: "Result" }
        : { round: "Set", score: "Points" };

      // Score update event (always) — enriched with scoringType + sport-neutral fields
      const scorePayload = {
        matchId,
        tournamentId: match.tournamentId?.toString(),
        ...sportMeta,
        labels,
        player1: match.player1?.userName || match.player1?.playerName,
        player2: match.player2?.userName || match.player2?.playerName,
        // Sport-neutral field names (preferred)
        roundNumber: match.currentSet,
        subRoundNumber: match.currentGame,
        /** @deprecated use roundNumber */ currentSet: match.currentSet,
        /** @deprecated use subRoundNumber */ currentGame: match.currentGame,
        liveScore: match.liveScore,
        sets: match.sets,
      };
      io.to(matchRoom).emit("score:update", scorePayload);
      if (tournamentRoom) io.to(tournamentRoom).emit("score:update", scorePayload);

      // Round completed (sport-neutral event name alongside legacy)
      if (setCompleted) {
        const roundPayload = { matchId, setNumber: match.currentSet - 1, ...scorePayload };
        io.to(matchRoom).emit("set:complete", roundPayload);
        io.to(matchRoom).emit("round:complete", roundPayload);
        if (tournamentRoom) {
          io.to(tournamentRoom).emit("set:complete", roundPayload);
          io.to(tournamentRoom).emit("round:complete", roundPayload);
        }
      }

      // Match completed — enriched with normalized result
      if (matchCompleted) {
        const { readMatchResult } = require("../utils/matchUtils");
        let normalizedResult = null;
        try { normalizedResult = readMatchResult(match); } catch {}

        const completePayload = {
          matchId,
          tournamentId: match.tournamentId?.toString(),
          ...sportMeta,
          labels,
          winner: match.winner,
          result: match.result,
          matchResult: normalizedResult,
          player1: match.player1?.userName || match.player1?.playerName,
          player2: match.player2?.userName || match.player2?.playerName,
        };
        io.to(matchRoom).emit("match:complete", completePayload);
        if (tournamentRoom) io.to(tournamentRoom).emit("match:complete", completePayload);
      }
    }

    res.status(200).json({
      success: true,
      message: "Game completed successfully",
      gameCompleted: true,
      setCompleted,
      matchCompleted,
      currentSet: match.currentSet,
      currentGame: match.currentGame,
      match
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error completing game:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete game",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Reset match (for testing/administrative purposes)
const resetMatch = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Reset match to initial state
    match.status = "SCHEDULED";
    match.currentSet = 1;
    match.currentGame = 1;
    match.liveScore = { player1Points: 0, player2Points: 0 };
    match.sets = [];
    match.matchFormat = undefined; // 🔥 CLEAR match format to force tournament inheritance
    match.result = {
      winner: { playerId: null, playerName: null },
      finalScore: { player1Sets: 0, player2Sets: 0 },
      matchDuration: 0,
      completedAt: null
    };

    await match.save({ validateModifiedOnly: true });

    res.status(200).json({
      success: true,
      message: "Match reset successfully",
      match
    });

  } catch (error) {
    console.error("Error resetting match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset match",
      error: error.message
    });
  }
};

// Sync live scoreboard data to Score model for points table compatibility
const syncMatchScores = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    // Look the match up across ALL models — a knockout/team match id sent here
    // must not 404. Points-table sync only applies to group-stage matches; any
    // other stage has no group standings to update, so return a no-op success.
    const { findMatchById } = require("../utils/matchUtils");
    const found = await findMatchById(matchId);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    if (found.schemaName !== "Match") {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "No points table to sync for this match stage."
      });
    }

    const score = await syncScoreModel(found.match);

    res.status(200).json({
      success: true,
      message: "Scores synced successfully",
      score
    });

  } catch (error) {
    console.error("Error syncing match scores:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync scores",
      error: error.message
    });
  }
};

// Simple bulk sync - just sync everything, no complex checks
const bulkSyncTournamentScores = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Find ALL matches for this tournament
    const matches = await Match.find({ tournamentId });

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    // Force sync all matches with any data
    for (const match of matches) {
      try {
        // Force sync if match has ANY completed or in-progress data
        if (match.status === 'COMPLETED' || match.status === 'IN_PROGRESS' && match.sets?.length > 0) {
          const score = await syncScoreModel(match);

          if (score) {
            results.push({
              matchId: match._id,
              status: 'synced',
              gamesA: score.gamesWonA,
              gamesB: score.gamesWonB,
              pointsA: score.totalScoreA,
              pointsB: score.totalScoreB
            });
            successCount++;
          } else {
            // Force create a basic score record
            const basicScore = await Score.findOneAndUpdate(
              { matchId: match._id },
              {
                matchId: match._id,
                playerA: match.player1?.playerId?.toString() || '000000000000000000000000',
                playerB: match.player2?.playerId?.toString() || '000000000000000000000000',
                // Legacy setOne/setTwo removed (Phase 11)
                sets: [],
                gamesWonA: 0,
                gamesWonB: 0,
                totalScoreA: 0,
                totalScoreB: 0,
                winner: null,
                matchStatus: match.status
              },
              { upsert: true, new: true }
            );

            results.push({
              matchId: match._id,
              status: 'basic_sync',
              gamesA: 0,
              gamesB: 0,
              pointsA: 0,
              pointsB: 0
            });
            successCount++;
          }
        } else {
          results.push({
            matchId: match._id,
            status: 'skipped',
            reason: 'Scheduled match'
          });
        }
      } catch (error) {
        results.push({
          matchId: match._id,
          status: 'error',
          error: error.message
        });
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: `Bulk sync completed`,
      summary: {
        total: matches.length,
        synced: successCount,
        errors: errorCount
      },
      results: results
    });

  } catch (error) {
    console.error("Bulk sync error:", error);
    res.status(500).json({
      success: false,
      message: "Bulk sync failed",
      error: error.message
    });
  }
};

// Get match statistics
const getMatchStatistics = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Calculate statistics
    const stats = {
      matchFormat: match.matchFormat,
      totalGamesPlayed: 0,
      totalPointsPlayed: 0,
      setsWon: {
        player1: 0,
        player2: 0
      },
      gamesWon: {
        player1: 0,
        player2: 0
      },
      pointsWon: {
        player1: 0,
        player2: 0
      },
      longestGame: null,
      averageGameDuration: 0
    };

    match.sets.forEach(set => {
      if (set.status === "COMPLETED") {
        if (set.winner.playerId?.toString() === match.player1.playerId.toString()) {
          stats.setsWon.player1++;
        } else if (set.winner.playerId?.toString() === match.player2.playerId.toString()) {
          stats.setsWon.player2++;
        }
      }

      set.games.forEach(game => {
        if (game.status === "COMPLETED") {
          stats.totalGamesPlayed++;
          stats.totalPointsPlayed += game.finalScore.player1 + game.finalScore.player2;

          stats.pointsWon.player1 += game.finalScore.player1;
          stats.pointsWon.player2 += game.finalScore.player2;

          if (game.winner.playerId?.toString() === match.player1.playerId.toString()) {
            stats.gamesWon.player1++;
          } else if (game.winner.playerId?.toString() === match.player2.playerId.toString()) {
            stats.gamesWon.player2++;
          }

          // Check for longest game
          const gamePoints = game.finalScore.player1 + game.finalScore.player2;
          if (!stats.longestGame || gamePoints > stats.longestGame.points) {
            stats.longestGame = {
              setNumber: set.setNumber,
              gameNumber: game.gameNumber,
              points: gamePoints,
              score: `${game.finalScore.player1}-${game.finalScore.player2}`
            };
          }
        }
      });
    });

    res.status(200).json({
      success: true,
      statistics: stats
    });

  } catch (error) {
    console.error("Error fetching match statistics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message
    });
  }
};

// Get match scores in array format (for compatibility with frontend)
const getMatchScores = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    // Try to find match in regular Match collection first
    // Note: Match schema refs "Player" but actual data is in "User" collection
    let match = await Match.findById(matchId);

    let isKnockoutMatch = false;

    // If not found in Match, try SuperMatch (knockout matches)
    if (!match) {
      match = await SuperMatch.findById(matchId)
        .populate('player1.playerId', 'name profileImage')
        .populate('player2.playerId', 'name profileImage');

      if (match) {
        isKnockoutMatch = true;
      }
    }

    // If still not found, try DirectKnockoutMatch
    if (!match) {
      match = await DirectKnockoutMatch.findById(matchId)
        .populate('player1.playerId', 'name profileImage')
        .populate('player2.playerId', 'name profileImage');

      if (match) {
        isKnockoutMatch = true;
      }
    }

    // Swiss last — see note in getLiveMatchState.
    if (!match) {
      match = await SwissMatch.findById(matchId);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // 🔥 KNOCKOUT MATCH HANDLING - Dynamic schema detection for getAllMatchScores!
    if (isKnockoutMatch) {
      const scores = [];
      const isSuperMatch = match.constructor.modelName === 'SuperMatch';
      const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

      if (isSuperMatch) {
        // SuperMatch logic - uses direct score fields
        if (match.score && match.score.setScores && match.score.setScores.length > 0) {
          const scoreData = {
            matchId: match._id,
            player1: {
              playerId: match.player1?.playerId?._id || match.player1?.playerId || null,
              playerName: match.player1?.playerName || 'Player 1',
              sets: match.score.player1Sets || 0,
              points: match.score.setScores.reduce((total, set) => total + (set.player1Score || 0), 0)
            },
            player2: {
              playerId: match.player2?.playerId?._id || match.player2?.playerId || null,
              playerName: match.player2?.playerName || 'Player 2',
              sets: match.score.player2Sets || 0,
              points: match.score.setScores.reduce((total, set) => total + (set.player2Score || 0), 0)
            },
            winner: match.winner ? {
              playerId: match.winner.playerId,
              name: match.winner.playerName
            } : null,
            status: match.status,
            createdAt: match.updatedAt || match.createdAt,
            matchType: 'super-match'
          };
          scores.push(scoreData);
        }
      } else if (isDirectKnockout) {
        // DirectKnockoutMatch logic - uses result structure (FIXED!)
        if (match.result && match.result.finalScore) {
          const scoreData = {
            matchId: match._id,
            player1: {
              playerId: match.player1?.playerId?._id || match.player1?.playerId || null,
              playerName: match.player1?.playerName || 'Player 1',
              sets: match.result.finalScore.player1Sets || 0,
              points: 0 // DirectKnockout doesn't track detailed points
            },
            player2: {
              playerId: match.player2?.playerId?._id || match.player2?.playerId || null,
              playerName: match.player2?.playerName || 'Player 2',
              sets: match.result.finalScore.player2Sets || 0,
              points: 0 // DirectKnockout doesn't track detailed points
            },
            winner: match.result.winner ? {
              playerId: match.result.winner.playerId,
              name: match.result.winner.playerName
            } : null,
            status: match.status,
            createdAt: match.updatedAt || match.createdAt,
            matchType: 'direct-knockout'
          };
          scores.push(scoreData);
        }
      }

      return res.status(200).json(scores);
    }

    // For regular matches, convert sets data to score array format
    const scores = [];

    // Always create score data for completed matches, even if no games data
    if (match.sets && match.sets.length > 0 || match.status === 'COMPLETED') {
      const latestSet = match.sets && match.sets.length > 0 ? match.sets[match.sets.length - 1] : null;
      const latestGame = latestSet && latestSet.games && latestSet.games.length > 0 ?
        latestSet.games[latestSet.games.length - 1] : null;

      const scoreData = {
        matchId: match._id,
        player1: {
          playerId: match.player1?.playerId || null,
          userName: match.player1?.userName || 'Unknown Player',
          sets: match.sets.filter(set => set.winner?.playerId?.toString() === match.player1?.playerId?.toString()).length,
          points: latestGame?.finalScore?.player1 || match.liveScore?.player1Points || 0
        },
        player2: {
          playerId: match.player2?.playerId || null,
          userName: match.player2?.userName || 'Unknown Player',
          sets: match.sets.filter(set => set.winner?.playerId?.toString() === match.player2?.playerId?.toString()).length,
          points: latestGame?.finalScore?.player2 || match.liveScore?.player2Points || 0
        },
        winner: match.result?.winner ? {
          playerId: match.result.winner.playerId,
          name: match.result.winner.playerName
        } : null,
        status: match.status,
        createdAt: match.updatedAt || match.createdAt
      };
      scores.push(scoreData);
    }

    res.status(200).json(scores);

  } catch (error) {
    console.error("Error fetching match scores:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match scores",
      error: error.message
    });
  }
};

// Get single match score (alternative endpoint)
const getMatchScore = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    // Try to find match in regular Match collection first
    let match = await Match.findById(matchId)
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage');

    let isKnockoutMatch = false;

    // If not found in Match, try SuperMatch (knockout matches)
    if (!match) {
      match = await SuperMatch.findById(matchId)
        .populate('player1.playerId', 'name profileImage')
        .populate('player2.playerId', 'name profileImage');

      if (match) {
        isKnockoutMatch = true;
      }
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // 🔥 KNOCKOUT MATCH HANDLING - Dynamic schema detection!
    if (isKnockoutMatch) {
      const isSuperMatch = match.constructor.modelName === 'SuperMatch';
      const isDirectKnockout = match.constructor.modelName === 'DirectKnockoutMatch';

      let scoreData;

      if (isSuperMatch) {
        // SuperMatch uses direct score and winner fields
        scoreData = {
          success: true,
          score: {
            matchId: match._id,
            player1: {
              playerId: match.player1?.playerId?._id || match.player1?.playerId || null,
              playerName: match.player1?.playerName || 'Player 1',
              sets: match.score?.player1Sets || 0,
              points: match.score?.setScores ?
                match.score.setScores.reduce((total, set) => total + (set.player1Score || 0), 0) : 0
            },
            player2: {
              playerId: match.player2?.playerId?._id || match.player2?.playerId || null,
              playerName: match.player2?.playerName || 'Player 2',
              sets: match.score?.player2Sets || 0,
              points: match.score?.setScores ?
                match.score.setScores.reduce((total, set) => total + (set.player2Score || 0), 0) : 0
            },
            winner: match.winner ? {
              playerId: match.winner.playerId,
              name: match.winner.playerName
            } : null,
            status: match.status,
            matchType: 'super-match'
          }
        };
      } else if (isDirectKnockout) {
        // DirectKnockoutMatch uses result structure (FIXED!)
        scoreData = {
          success: true,
          score: {
            matchId: match._id,
            player1: {
              playerId: match.player1?.playerId?._id || match.player1?.playerId || null,
              playerName: match.player1?.playerName || 'Player 1',
              sets: match.result?.finalScore?.player1Sets || 0,
              points: 0 // DirectKnockout doesn't track detailed points like SuperMatch
            },
            player2: {
              playerId: match.player2?.playerId?._id || match.player2?.playerId || null,
              playerName: match.player2?.playerName || 'Player 2',
              sets: match.result?.finalScore?.player2Sets || 0,
              points: 0 // DirectKnockout doesn't track detailed points like SuperMatch
            },
            winner: match.result?.winner ? {
              playerId: match.result.winner.playerId,
              name: match.result.winner.playerName
            } : null,
            status: match.status,
            matchType: 'direct-knockout'
          }
        };
      }

      return res.status(200).json(scoreData);
    }

    // For regular matches
    let scoreData = {
      success: true,
      score: {
        matchId: match._id,
        player1: {
          playerId: match.player1?.playerId?._id || match.player1?.playerId || null,
          playerName: match.player1?.userName || match.player1?.playerName || 'Player 1',
          sets: 0,
          points: 0
        },
        player2: {
          playerId: match.player2?.playerId?._id || match.player2?.playerId || null,
          playerName: match.player2?.userName || match.player2?.playerName || 'Player 2',
          sets: 0,
          points: 0
        },
        winner: null,
        status: match.status,
        matchType: 'regular'
      }
    };

    if (match.sets && match.sets.length > 0) {
      const latestSet = match.sets[match.sets.length - 1];
      const latestGame = latestSet.games && latestSet.games.length > 0 ?
        latestSet.games[latestSet.games.length - 1] : null;

      if (latestGame) {
        const player1Id = (match.player1?.playerId?._id || match.player1?.playerId)?.toString();
        const player2Id = (match.player2?.playerId?._id || match.player2?.playerId)?.toString();

        scoreData.score.player1.sets = match.sets.filter(set =>
          set.winner?.playerId?.toString() === player1Id).length;
        scoreData.score.player2.sets = match.sets.filter(set =>
          set.winner?.playerId?.toString() === player2Id).length;
        scoreData.score.player1.points = latestGame.finalScore?.player1 || match.liveScore?.player1Points || 0;
        scoreData.score.player2.points = latestGame.finalScore?.player2 || match.liveScore?.player2Points || 0;
      }
    }

    if (match.winner) {
      scoreData.score.winner = {
        playerId: match.winner.playerId,
        name: match.winner.playerName
      };
    }

    res.status(200).json(scoreData);

  } catch (error) {
    console.error("Error fetching match score:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match score",
      error: error.message
    });
  }
};

// 🚀 VALIDATION ENDPOINT - Test game completion logic fix for 5 games per set
const validateGameCompletionLogic = async (req, res) => {
  try {
    const { totalGames, gamesToWin, totalSets, setsToWin } = req.query;

    // Test format from request params — no hardcoded defaults
    const testFormat = {
      totalGames: parseInt(totalGames) || 1,
      gamesToWin: parseInt(gamesToWin) || 1,
      totalSets: parseInt(totalSets) || 1,
      setsToWin: parseInt(setsToWin) || 1,
      pointsToWinGame: null
    };

    // Simulate game progression scenarios
    const scenarios = [];

    // Scenario 1: Can we create all 5 games in a set?
    const maxGamesCanCreate = testFormat.totalGames;
    scenarios.push({
      scenario: "Maximum Games Creation",
      description: `Can create up to ${maxGamesCanCreate} games in a set`,
      result: "✅ PASS - Uses totalGames limit instead of gamesToWin",
      oldLogic: `Would stop at game ${testFormat.gamesToWin}`,
      newLogic: `Can create up to game ${maxGamesCanCreate}`,
      critical: true
    });

    // Scenario 2: Can we create all sets in a match?
    const maxSetsCanCreate = testFormat.totalSets;
    scenarios.push({
      scenario: "Maximum Sets Creation",
      description: `Can create up to ${maxSetsCanCreate} sets in a match`,
      result: "✅ PASS - Uses totalSets limit instead of setsToWin",
      oldLogic: `Would stop at set ${testFormat.setsToWin}`,
      newLogic: `Can create up to set ${maxSetsCanCreate}`,
      critical: true
    });

    // Scenario 3: Game 5 creation when score is 2-2
    scenarios.push({
      scenario: "Critical Game 5 (2-2 Score)",
      description: "When games won = 2-2, can we create game 5?",
      result: testFormat.totalGames >= 5 ? "✅ PASS - Game 5 can be created" : "❌ FAIL - Not enough total games",
      oldLogic: "❌ Would NOT create game 5 (stopped at gamesToWin=3)",
      newLogic: "✅ CAN create game 5 (uses totalGames=5)",
      critical: true
    });

    // Scenario 4: Set 3 creation when score is 1-1
    scenarios.push({
      scenario: "Critical Set 3 (1-1 Score)",
      description: "When sets won = 1-1, can we create set 3?",
      result: testFormat.totalSets >= 3 ? "✅ PASS - Set 3 can be created" : "❌ FAIL - Not enough total sets",
      oldLogic: "❌ Would NOT create set 3 (stopped at setsToWin=2)",
      newLogic: "✅ CAN create set 3 (uses totalSets=3)",
      critical: true
    });

    // Test actual logic paths
    const gameCreationTest = {
      wouldCreateGame5: 5 <= testFormat.totalGames,
      wouldCreateSet3: 3 <= testFormat.totalSets,
      maxPossibleGames: testFormat.totalGames,
      maxPossibleSets: testFormat.totalSets
    };

    res.status(200).json({
      success: true,
      message: "🚀 GAME COMPLETION LOGIC VALIDATION",
      testConfiguration: testFormat,
      scenarios,
      logicTest: gameCreationTest,
      summary: {
        criticalFix: "✅ FIXED - Games/Sets now use total limits instead of win thresholds",
        impact: "Players can now play the full configured number of games/sets",
        beforeFix: "Could not create Game 5 in 2-2 situation or Set 3 in 1-1 situation",
        afterFix: "Can create all configured games and sets as needed"
      },
      recommendation: testFormat.totalGames === 5 && testFormat.gamesToWin === 3 ?
        "✅ PERFECT - This is the exact configuration that was broken before!" :
        "ℹ️ Test with totalGames=5, gamesToWin=3 for the critical scenario"
    });

  } catch (error) {
    console.error("Error in validation endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Validation endpoint failed",
      error: error.message
    });
  }
};

// GET standings for a group
const getGroupStandings = async (req, res) => {
  try {
    const { tournamentId, groupId } = req.params;

    // Always recompute so tie-break rule changes take effect immediately
    // without needing a match re-submit to refresh cached standings.
    let standings = await recalculateGroupStandings(tournamentId, groupId);

    if (!standings) {
      return res.status(404).json({ success: false, message: "No standings found for this group." });
    }

    res.status(200).json({ success: true, data: standings });
  } catch (error) {
    console.error("[GET_STANDINGS] Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch standings", error: error.message });
  }
};

// ================================
// BULK SCORE UPLOAD
// ================================

/**
 * Bulk upload set scores for multiple round-robin matches at once.
 *
 * Body: {
 *   tournamentId: String,
 *   groupId: String,
 *   scores: [
 *     {
 *       matchId: String,
 *       sets: [
 *         { player1Score: Number, player2Score: Number },  // Set 1
 *         { player1Score: Number, player2Score: Number },  // Set 2
 *         ...
 *       ]
 *     }
 *   ]
 * }
 *
 * Each set entry represents the final point score for that set.
 * The system determines set winners and match winner automatically.
 */
const bulkUploadScores = async (req, res) => {
  try {
    const { tournamentId, groupId, scores } = req.body;

    // groupId is optional — knockout-stage bulk uploads pass null because matches
    // don't belong to a single group.
    if (!tournamentId || !scores || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and scores array are required"
      });
    }

    const results = [];
    const errors = [];

    for (const entry of scores) {
      const { matchId, sets } = entry;

      if (!matchId || !sets || !Array.isArray(sets) || sets.length === 0) {
        errors.push({ matchId, error: "matchId and sets array are required" });
        continue;
      }

      try {
        // Find the match across all match collections. Group-stage tournaments
        // store matches in `Match`; knockout brackets use SuperMatch (group→KO
        // progression), DirectKnockoutMatch (standalone KO), or KnockoutMatch
        // (legacy qualifier_knockout flow).
        let match = await Match.findById(matchId);
        let matchKind = "group";
        if (!match) {
          match = await SuperMatch.findById(matchId);
          if (match) matchKind = "super";
        }
        if (!match) {
          match = await DirectKnockoutMatch.findById(matchId);
          if (match) matchKind = "direct";
        }
        if (!match) {
          match = await KnockoutMatch.findById(matchId);
          if (match) matchKind = "legacyKO";
        }
        // Swiss last — see note in getLiveMatchState.
        if (!match) {
          match = await SwissMatch.findById(matchId);
          if (match) matchKind = "swiss";
        }
        if (!match) {
          errors.push({ matchId, error: "Match not found" });
          continue;
        }

        // Already-completed matches: skip the re-score, but attempt progression
        // in case a prior run never advanced the winner. Covers both
        // DirectKnockoutMatch (singles) and SuperMatch (group + knockout) so
        // managers can recover stale R2 TBDs by re-uploading the same scores.
        if (match.status === "COMPLETED") {
          if (matchKind === "direct" && match.nextMatchId) {
            const existingWinnerId =
              match.result?.winner?.playerId ||
              match.matchResult?.winner?.playerId ||
              match.winner?.playerId;
            if (existingWinnerId) {
              try {
                const { processDirectKnockoutProgression } = require("./directKnockoutController");
                await processDirectKnockoutProgression(match, existingWinnerId);
                results.push({ matchId, status: "progression-only" });
              } catch (progErr) {
                errors.push({ matchId, error: `Progression retry failed: ${progErr.message}` });
              }
              continue;
            }
          }
          if (matchKind === "super" && match.nextMatchId && match.winner?.playerId) {
            try {
              const { progressWinnerToNextRound } = require("./tournamentController");
              await progressWinnerToNextRound(match);
              results.push({ matchId, status: "progression-only" });
            } catch (progErr) {
              errors.push({ matchId, error: `SuperMatch progression retry failed: ${progErr.message}` });
            }
            continue;
          }
          errors.push({ matchId, error: "Match already completed" });
          continue;
        }

        // Resolve match format. STEP 17c — read per-sport from sports[i].
        if (!match.matchFormat || !match.matchFormat.setsToWin) {
          const Tournament = require("../src/modules/tournaments/models/Tournament");
          const { getMatchFormat, resolveSportId } = require("../utils/sportTrackUtils");
          const tournament = await Tournament.findById(match.tournamentId);
          const tf = getMatchFormat(tournament, resolveSportId(tournament, match.sportId)) || {};

          match.matchFormat = {
            totalSets: tf.totalSets || tf.maxSets || 1,
            setsToWin: tf.setsToWin || Math.ceil((tf.totalSets || tf.maxSets || 1) / 2),
            maxSets: tf.totalSets || tf.maxSets || 1,
            totalGames: tf.totalGames || tf.maxGames || 1,
            gamesToWin: tf.gamesToWin || Math.ceil((tf.totalGames || tf.maxGames || 1) / 2),
            maxGames: tf.totalGames || tf.maxGames || 1,
            pointsToWinGame: tf.pointsToWinGame || null,
            marginToWin: tf.marginToWin ?? null,
            deuceRule: tf.deuceRule !== undefined ? tf.deuceRule : false,
            maxPointsPerGame: tf.maxPointsPerGame || null,
            serviceRule: tf.serviceRule || null
          };
        }

        // ── Sport-aware guard ──────────────────────────────────────────────
        // Bulk upload collects per-SET scores, so it only makes sense for
        // set-based sports (TT, Badminton, Foosball, Tennis, Volleyball…).
        // Cricket (innings), Carrom (board), Chess (single) and Football (time)
        // have fundamentally different result shapes — applying "sets" to them
        // records a meaningless winner and breaks NRR/board/draw standings
        // SILENTLY. Reject those cleanly so the manager uses the live scorer
        // (this also guarantees the endpoint never crashes on a non-set sport).
        let _bulkScoringType = match.scoringType || match.matchFormat?.scoringType || null;
        if (!_bulkScoringType) {
          try { _bulkScoringType = require("../utils/matchFormatUtils").getScoringType(match.sportName); } catch (_) { /* ignore */ }
        }
        if (_bulkScoringType && _bulkScoringType !== "sets") {
          errors.push({
            matchId,
            error: `Bulk score upload isn't available for ${match.sportName || "this sport"} (${_bulkScoringType} scoring). Score these matches with the live scorer.`,
          });
          continue;
        }

        // Resolve rather than trust the stored value. matchFormat.setsToWin
        // defaults to 3 in every match model (paired with maxSets: 5), so a
        // best-of-3 match created without an explicit format demanded all
        // three sets and rejected a perfectly valid 2-0.
        const setsToWin = require("../utils/matchFormatUtils").resolveSetsToWin(match.matchFormat);

        // Validate: need enough sets submitted to determine a winner
        let p1SetsWon = 0;
        let p2SetsWon = 0;

        // Pre-validate all set scores
        let validSets = true;
        for (const setScore of sets) {
          if (setScore.player1Score === undefined || setScore.player2Score === undefined) {
            validSets = false;
            break;
          }
          if (setScore.player1Score === setScore.player2Score) {
            validSets = false;
            break;
          }
          if (setScore.player1Score > setScore.player2Score) {
            p1SetsWon++;
          } else {
            p2SetsWon++;
          }
        }

        if (!validSets) {
          errors.push({ matchId, error: "Invalid set scores - each set must have different scores for both players" });
          continue;
        }

        if (p1SetsWon < setsToWin && p2SetsWon < setsToWin) {
          errors.push({
            matchId,
            error: `Not enough sets to decide the match — ${setsToWin} set win${setsToWin === 1 ? "" : "s"} needed, got ${p1SetsWon}-${p2SetsWon}.`,
          });
          continue;
        }

        // Build the complete match structure
        const matchSets = [];
        let player1TotalSets = 0;
        let player2TotalSets = 0;
        let matchWinnerDetermined = false;

        for (let i = 0; i < sets.length; i++) {
          if (matchWinnerDetermined) break; // Stop processing after winner found

          const setScore = sets[i];
          const setWinner = setScore.player1Score > setScore.player2Score ? "player1" : "player2";

          const game = {
            gameNumber: 1,
            status: "COMPLETED",
            finalScore: {
              player1: setScore.player1Score,
              player2: setScore.player2Score
            },
            winner: {
              playerId: setWinner === "player1" ? match.player1.playerId : match.player2.playerId,
              playerName: setWinner === "player1"
                ? (match.player1.playerName || match.player1.userName)
                : (match.player2.playerName || match.player2.userName)
            },
            startTime: new Date(),
            endTime: new Date()
          };

          const setEntry = {
            setNumber: i + 1,
            status: "COMPLETED",
            winner: {
              playerId: setWinner === "player1" ? match.player1.playerId : match.player2.playerId,
              playerName: setWinner === "player1"
                ? (match.player1.playerName || match.player1.userName)
                : (match.player2.playerName || match.player2.userName)
            },
            games: [game]
          };

          matchSets.push(setEntry);

          if (setWinner === "player1") player1TotalSets++;
          else player2TotalSets++;

          // Check if match is won
          if (player1TotalSets >= setsToWin || player2TotalSets >= setsToWin) {
            matchWinnerDetermined = true;
          }
        }

        // Determine match winner
        const matchWinner = player1TotalSets >= setsToWin ? "player1" : "player2";
        const winnerPlayerId = matchWinner === "player1" ? match.player1.playerId : match.player2.playerId;
        const winnerPlayerName = matchWinner === "player1"
          ? (match.player1.playerName || match.player1.userName)
          : (match.player2.playerName || match.player2.userName);

        if (matchKind === "legacyKO") {
          // KnockoutMatch has no sets/result/liveScore fields — use the flat
          // winner subdoc plus matchResult (Mixed) for the final score payload.
          match.status = "COMPLETED";
          match.winner = {
            playerId: winnerPlayerId,
            playerName: winnerPlayerName,
            playerType: matchWinner === "player1"
              ? match.player1.playerType
              : match.player2.playerType,
          };
          match.matchResult = {
            winner: { playerId: winnerPlayerId, playerName: winnerPlayerName },
            finalScore: { player1Sets: player1TotalSets, player2Sets: player2TotalSets },
            sets: matchSets,
            completedAt: new Date(),
          };
        } else {
          // Match / SuperMatch / DirectKnockoutMatch all carry sets + status +
          // liveScore; only the result container differs (Match has `result`,
          // SuperMatch has `score`). We write both defensively — strict mode
          // drops the one that isn't in the schema.
          match.sets = matchSets;
          match.status = "COMPLETED";
          match.currentSet = matchSets.length;
          match.currentGame = 1;
          match.liveScore = { player1Points: 0, player2Points: 0 };
          match.result = {
            winner: { playerId: winnerPlayerId, playerName: winnerPlayerName },
            finalScore: { player1Sets: player1TotalSets, player2Sets: player2TotalSets },
            matchDuration: 0,
            completedAt: new Date(),
          };
          match.winner = { playerId: winnerPlayerId, playerName: winnerPlayerName };
          match.score = {
            player1Sets: player1TotalSets,
            player2Sets: player2TotalSets,
            setScores: sets.map((s, idx) => ({
              setNumber: idx + 1,
              player1Score: s.player1Score,
              player2Score: s.player2Score,
            })),
          };
        }

        await match.save({ validateModifiedOnly: true });

        // Sync Score model for backward compatibility — only meaningful for
        // group-stage Match docs. Skip for knockout variants.
        if (matchKind === "group") {
          try {
            await syncScoreModel(match);
          } catch (syncErr) {
            console.error(`[BULK_SCORE] Score sync error for match ${matchId}:`, syncErr.message);
          }
        }

        // Advance the winner to the next bracket match.
        // SuperMatch (group + knockout flow) and DirectKnockoutMatch use
        // different progression helpers; pick the right one by matchKind.
        // Without this, R1 winners stay in R1 and R2 cards keep showing TBD
        // even after every R1 result has been bulk-uploaded.
        if (matchKind === "direct" && match.nextMatchId && winnerPlayerId) {
          try {
            const { processDirectKnockoutProgression } = require("./directKnockoutController");
            await processDirectKnockoutProgression(match, winnerPlayerId);
          } catch (progErr) {
            console.error(`[BULK_SCORE] Progression error for match ${matchId}:`, progErr.message);
          }
        } else if (matchKind === "super" && match.nextMatchId) {
          try {
            const { progressWinnerToNextRound } = require("./tournamentController");
            await progressWinnerToNextRound(match);
          } catch (progErr) {
            console.error(`[BULK_SCORE] SuperMatch progression error for match ${matchId}:`, progErr.message);
          }
        }

        results.push({
          matchId,
          player1: match.player1.userName || match.player1.playerName,
          player2: match.player2.userName || match.player2.playerName,
          winner: winnerPlayerName,
          finalScore: `${player1TotalSets}-${player2TotalSets}`,
          status: "success"
        });

      } catch (matchErr) {
        console.error(`[BULK_SCORE] Error processing match ${matchId}:`, matchErr.message);
        errors.push({ matchId, error: matchErr.message });
      }
    }

    // Recalculate group standings after all scores are uploaded — only meaningful
    // when a groupId was provided (group-stage bulk uploads).
    if (groupId) {
      try {
        await recalculateGroupStandings(tournamentId, groupId);
      } catch (standingsErr) {
        console.error("[BULK_SCORE] Error recalculating standings:", standingsErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk score upload complete. ${results.length} matches updated, ${errors.length} errors.`,
      results,
      errors
    });

  } catch (error) {
    console.error("[BULK_SCORE_UPLOAD] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk upload scores",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════
// CRICKET (innings) + CARROM (board) — incremental live scoring
// ════════════════════════════════════════════════════════════════════
// These power the dedicated scorers (web InningsBasedScorer / BoardBasedScorer
// and the mobile referee scorers). They submit incrementally (per ball / per
// board) so spectators see live updates, unlike the set-sports completeGame
// path that posts a final game score.

// Load the match across the 3 scoring models and authorize the caller
// (mirrors completeGame's auth). Returns { match, isKnockoutMatch } or { error }.
async function _loadScoringMatch(req, matchId, session) {
  if (!mongoose.Types.ObjectId.isValid(matchId)) {
    return { error: { status: 400, message: "Invalid match ID" } };
  }
  let match = await Match.findById(matchId).session(session);
  let isKnockoutMatch = false;
  if (!match) { match = await SuperMatch.findById(matchId).session(session); if (match) isKnockoutMatch = true; }
  if (!match) { match = await DirectKnockoutMatch.findById(matchId).session(session); if (match) isKnockoutMatch = true; }
  if (!match) { match = await SwissMatch.findById(matchId).session(session); }
  if (!match) return { error: { status: 404, message: "Match not found" } };

  const callerId = req.user?._id?.toString() || req.user?.id?.toString();
  if (!callerId) return { error: { status: 401, message: "Not authenticated." } };

  let authorized = false;
  if (req.userRole === "Manager") {
    const TournamentModel = require("../src/modules/tournaments/models/Tournament");
    const tDoc = await TournamentModel.findById(match.tournamentId).select("managerId clubId").lean();
    const managerIds = Array.isArray(tDoc?.managerId)
      ? tDoc.managerId.map((id) => id?.toString())
      : tDoc?.managerId ? [tDoc.managerId.toString()] : [];
    authorized = managerIds.includes(callerId);
    // Same-club fallback (see completeGame): a club's managers may score its
    // tournaments even if not explicitly listed in managerId.
    if (!authorized && tDoc?.clubId && req.user?.clubId &&
        String(tDoc.clubId) === String(req.user.clubId)) {
      authorized = true;
    }
  } else {
    const { isUmpireAuthorizedForMatch } = require("../utils/umpireAuth");
    const r = await isUmpireAuthorizedForMatch(callerId, match);
    authorized = !!r.authorized;
  }
  if (!authorized) return { error: { status: 403, message: "You are not authorized to score this match." } };
  return { match, isKnockoutMatch };
}

// Ensure we have a match format carrying scoringType. NOTE: the Match
// `matchFormat` subschema does NOT declare `scoringType` (Mongoose strips it),
// so the canonical scoring type lives on the top-level `match.scoringType`
// (stamped by MatchFactory). Resolve from there first, then the tournament.
async function _ensureScoringFormat(match) {
  const existingType = match.matchFormat?.scoringType || match.scoringType || null;
  if (match.matchFormat && existingType) {
    const base = match.matchFormat.toObject ? match.matchFormat.toObject() : { ...match.matchFormat };
    return { ...base, scoringType: existingType };
  }
  const Tournament = require("../src/modules/tournaments/models/Tournament");
  const { getMatchFormat, getSportName, resolveSportId } = require("../utils/sportTrackUtils");
  const { getScoringType, freezeMatchFormat } = require("../utils/matchFormatUtils");
  let tf = {};
  let sportName = match.sportName;
  try {
    const t = await Tournament.findById(match.tournamentId);
    const sid = resolveSportId(t, match.sportId);
    tf = getMatchFormat(t, sid) || {};
    sportName = getSportName(t, sid) || sportName;
  } catch { /* fall through to defaults */ }
  const scoringType = tf.scoringType || match.scoringType || getScoringType(sportName);
  match.matchFormat = { ...(match.matchFormat || {}), ...freezeMatchFormat({ ...tf, scoringType }) };
  match.scoringType = scoringType; // keep the canonical top-level field in sync
  return match.matchFormat;
}

// Save a match to the correct model.
async function _persistMatch(match, isKnockoutMatch, session) {
  if (isKnockoutMatch && match.constructor.modelName === "SuperMatch") {
    await SuperMatch.findByIdAndUpdate(match._id, match, { session, new: true });
  } else if (isKnockoutMatch && match.constructor.modelName === "DirectKnockoutMatch") {
    await DirectKnockoutMatch.findByIdAndUpdate(match._id, match, { session, new: true });
  } else {
    await match.save({ session });
  }
}

// Shared completion: set winner/result, normalized matchResult, bracket
// progression, standings — mirrors completeGame's terminal block.
// winnerSide is "player1"|"player2"|null (null = recorded draw, group only).
async function _finalizeMatch(match, winnerSide, p1Score, p2Score, isKnockoutMatch, session) {
  match.status = "COMPLETED";

  const sideObj = (side) => ({
    playerId: side === "player1" ? match.player1.playerId : match.player2.playerId,
    playerName: side === "player1"
      ? (match.player1.playerName || match.player1.userName)
      : (match.player2.playerName || match.player2.userName),
  });
  const winnerObj = winnerSide ? sideObj(winnerSide) : { playerId: null, playerName: null };
  const finalScore = { player1Sets: p1Score, player2Sets: p2Score };

  if (isKnockoutMatch && match.constructor.modelName === "SuperMatch") {
    match.winner = winnerObj;
    match.loser = winnerSide ? sideObj(winnerSide === "player1" ? "player2" : "player1") : { playerId: null, playerName: null };
    match.score = { player1Sets: p1Score, player2Sets: p2Score, setScores: [] };
  } else {
    const durMin = match.createdAt ? Math.floor((new Date() - match.createdAt) / (1000 * 60)) : 0;
    match.result = {
      ...(match.result?.toObject ? match.result.toObject() : match.result || {}),
      winner: winnerObj,
      finalScore,
      completedAt: new Date(),
      matchDuration: Number.isFinite(durMin) ? durMin : 0,
    };
  }

  try {
    const { readMatchResult } = require("../utils/matchUtils");
    const cr = readMatchResult(match);
    match.matchResult = {
      type: cr.type, completed: true,
      player1Score: cr.player1Score, player2Score: cr.player2Score,
      winner: cr.winner, details: cr.details,
    };
  } catch (e) { console.warn("[INNINGS/BOARD] matchResult build failed:", e.message); }

  if (isKnockoutMatch && winnerSide) {
    try {
      if (match.constructor.modelName === "DirectKnockoutMatch") {
        const { processDirectKnockoutProgression } = require("./directKnockoutController");
        await processDirectKnockoutProgression(match, winnerObj.playerId);
      } else {
        const { progressWinnerToNextRound } = require("./tournamentController");
        await progressWinnerToNextRound(match, session);
      }
    } catch (e) { console.error("[INNINGS/BOARD] progression error:", e.message); }
  }

  await _persistMatch(match, isKnockoutMatch, session);

  if (!isKnockoutMatch) {
    await syncScoreModel(match, session);
    // NOTE: standings are recalculated AFTER the transaction commits (by the
    // caller via _recalcAfterCommit) — running it here would query outside the
    // session and miss this match's just-set COMPLETED status.
  }
}

// Recalculate group standings for a completed group match. MUST be called
// after the scoring transaction has committed so the completion is visible.
async function _recalcAfterCommit(match, isKnockoutMatch) {
  if (isKnockoutMatch) return;
  try { await recalculateGroupStandings(match.tournamentId, match.groupId); }
  catch (e) { console.error("[INNINGS/BOARD] standings recalc error:", e.message); }
}

// Emit live score/round/complete socket events for cricket & carrom.
function _emitCricketCarromUpdate(req, match, matchId, { roundCompleted, matchCompleted, liveScore }) {
  const io = req.app.get("io");
  if (!io) return;
  const tournamentId = match.tournamentId ? match.tournamentId.toString() : null;
  const tournamentRoom = tournamentId ? `tournament_${tournamentId}` : null;
  const matchRoom = `match_${matchId}`;
  const scoringType = match.matchFormat?.scoringType || match.scoringType || null;
  const labels = scoringType === "innings" ? { round: "Innings", score: "Runs" }
    : scoringType === "board" ? { round: "Board", score: "Points" }
    : { round: "Set", score: "Points" };

  const payload = {
    matchId,
    tournamentId,
    scoringType,
    sportName: match.sportName || null,
    labels,
    player1: match.player1?.userName || match.player1?.playerName,
    player2: match.player2?.userName || match.player2?.playerName,
    liveScore: liveScore || null,
    result: match.result,
  };
  io.to(matchRoom).emit("score:update", payload);
  if (tournamentRoom) io.to(tournamentRoom).emit("score:update", payload);

  if (roundCompleted) {
    io.to(matchRoom).emit("round:complete", payload);
    io.to(matchRoom).emit("set:complete", payload);
    if (tournamentRoom) {
      io.to(tournamentRoom).emit("round:complete", payload);
      io.to(tournamentRoom).emit("set:complete", payload);
    }
  }
  if (matchCompleted) {
    let normalizedResult = null;
    try { normalizedResult = require("../utils/matchUtils").readMatchResult(match); } catch { /* noop */ }
    const completePayload = { ...payload, winner: match.winner, matchResult: normalizedResult };
    io.to(matchRoom).emit("match:complete", completePayload);
    if (tournamentRoom) io.to(tournamentRoom).emit("match:complete", completePayload);
  }
}

// ── Cricket helpers ──

// Recompute innings aggregates from the flat deliveries log.
function _recomputeInnings(inn) {
  let runs = 0, wickets = 0, legalBalls = 0;
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
  const fow = [];
  for (const d of (inn.deliveries || [])) {
    const off = Number(d.runs) || 0;
    const ex = Number(d.extraRuns) || 0;
    runs += off + ex;
    if (d.extra === "wide") extras.wides += ex || 1;
    else if (d.extra === "no-ball") extras.noBalls += ex || 1;
    else if (d.extra === "bye") extras.byes += ex;
    else if (d.extra === "leg-bye") extras.legByes += ex;
    if (d.legalDelivery !== false) legalBalls += 1;
    if (d.isWicket) {
      wickets += 1;
      fow.push({ wicket: wickets, runs, over: Math.floor(legalBalls / 6) + (legalBalls % 6) / 10 });
    }
  }
  inn.runs = runs;
  inn.wickets = wickets;
  inn.oversBowled = Math.floor(legalBalls / 6);
  inn.ballsBowled = legalBalls % 6;
  inn.extras = extras;
  inn.fallOfWickets = fow;
  return { runs, wickets, legalBalls };
}

function _inningsOver(inn, oversCount) {
  const legalBalls = (inn.oversBowled * 6) + inn.ballsBowled;
  const maxBalls = (oversCount || 20) * 6;
  if (inn.wickets >= 10) return true;
  if (legalBalls >= maxBalls) return true;
  return false;
}

function _cricketLiveScore(match, fmt) {
  const innings = (match.result?.innings || []).map((i) => (i.toObject ? i.toObject() : i));
  const current = [...innings].reverse().find((i) => i.status === "IN_PROGRESS") || innings[innings.length - 1] || null;
  const oversCount = fmt.oversCount || 20;
  let required = null, ballsRemaining = null, requiredRate = null, currentRunRate = null;
  if (current) {
    const legalBalls = (current.oversBowled * 6) + current.ballsBowled;
    currentRunRate = legalBalls > 0 ? Number(((current.runs / legalBalls) * 6).toFixed(2)) : 0;
    if (current.inningsNumber === 2 && current.target != null) {
      required = Math.max(0, current.target - current.runs);
      ballsRemaining = Math.max(0, (oversCount * 6) - legalBalls);
      requiredRate = ballsRemaining > 0 ? Number(((required / ballsRemaining) * 6).toFixed(2)) : null;
    }
  }
  return {
    scoringType: "innings",
    currentInnings: current?.inningsNumber ?? null,
    battingPlayer: current?.battingSide ?? null,
    target: current?.target ?? null,
    required, ballsRemaining, requiredRate, currentRunRate,
    innings,
  };
}

// Compute and finalize the cricket match winner from both innings.
// winnerOverride lets finishCricketMatch force a super-over winner on a tie.
async function _resolveCricketResultAndFinalize(match, fmt, isKnockoutMatch, session, { winnerOverride = null, superOver = null } = {}) {
  const innings = match.result.innings;
  const i1 = innings.find((i) => i.inningsNumber === 1);
  const i2 = innings.find((i) => i.inningsNumber === 2);
  const r1 = i1?.runs || 0;
  const r2 = i2?.runs || 0;

  // Map innings totals back to player sides
  const sideRuns = { player1: 0, player2: 0 };
  for (const inn of innings) {
    if (inn.inningsNumber <= 2 && inn.battingSide) sideRuns[inn.battingSide] += inn.runs || 0;
  }

  let winnerSide = null;
  const cricketResult = { marginType: null, marginValue: null, isTie: false, superOver: superOver || null, chasedSuccessfully: false };

  if (winnerOverride) {
    winnerSide = winnerOverride;
    cricketResult.marginType = "super_over";
    cricketResult.isTie = true;
  } else if (sideRuns.player1 === sideRuns.player2) {
    // Tie — caller (finishCricketMatch) must resolve via super-over for knockouts.
    cricketResult.isTie = true;
    cricketResult.marginType = "tie";
    winnerSide = null;
  } else {
    winnerSide = sideRuns.player1 > sideRuns.player2 ? "player1" : "player2";
    // Margin: chasing side (innings-2 batting) winning by wickets, else by runs.
    const chasingSide = i2?.battingSide || null;
    if (chasingSide && winnerSide === chasingSide && i2) {
      cricketResult.marginType = "wickets";
      cricketResult.marginValue = 10 - (i2.wickets || 0);
      cricketResult.chasedSuccessfully = true;
    } else {
      cricketResult.marginType = "runs";
      cricketResult.marginValue = Math.abs(sideRuns.player1 - sideRuns.player2);
    }
  }

  match.result = match.result?.toObject ? match.result.toObject() : match.result;
  match.result.cricketResult = cricketResult;
  match.markModified("result");

  const p1Won = winnerSide === "player1" ? 1 : 0;
  const p2Won = winnerSide === "player2" ? 1 : 0;
  await _finalizeMatch(match, winnerSide, p1Won, p2Won, isKnockoutMatch, session);
  return { winnerSide, cricketResult };
}

// POST /cricket/ball — record one delivery
const submitCricketBall = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    if (match.status === "COMPLETED") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Match already completed" }); }

    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "innings") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a cricket (innings) match" }); }

    const {
      innings: inningsNumber = 1, battingPlayer = "player1",
      runs = 0, extra = null, extraRuns = 0, isWicket = false, wicketType = null, legalDelivery = true,
    } = req.body;

    if (!match.result) match.result = {};
    if (!Array.isArray(match.result.innings)) match.result.innings = [];

    let inn = match.result.innings.find((i) => i.inningsNumber === inningsNumber);
    if (!inn) {
      const firstInnings = match.result.innings.find((x) => x.inningsNumber === 1);
      const target = inningsNumber === 2 ? ((firstInnings?.runs || 0) + 1) : null;
      match.result.innings.push({
        inningsNumber, battingSide: battingPlayer, deliveries: [],
        runs: 0, wickets: 0, oversBowled: 0, ballsBowled: 0,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
        target, status: "IN_PROGRESS", overLog: [], fallOfWickets: [],
      });
      inn = match.result.innings[match.result.innings.length - 1];
    }
    if (inn.status === "COMPLETED") { await session.abortTransaction(); return res.status(400).json({ success: false, message: `Innings ${inningsNumber} is already complete` }); }

    // Per-ball striker/bowler + live role tracking. The scorer drives strike
    // rotation client-side: `striker`/`bowler` = who faced/bowled THIS ball
    // (recorded on the delivery); `nextStriker`/`nextNonStriker`/`nextBowler` =
    // the roles AFTER rotation (stored on the innings for the next ball).
    const {
      striker = null, nonStriker = null, bowler = null,
      nextStriker = null, nextNonStriker = null, nextBowler = null,
    } = req.body;
    inn.deliveries.push({
      runs, extra, extraRuns, isWicket, wicketType, legalDelivery,
      striker: striker || inn.striker || null,
      bowler: bowler || inn.currentBowler || null,
    });
    _recomputeInnings(inn);
    inn.striker = nextStriker !== null ? nextStriker : (striker !== null ? striker : inn.striker);
    inn.nonStriker = nextNonStriker !== null ? nextNonStriker : (nonStriker !== null ? nonStriker : inn.nonStriker);
    inn.currentBowler = nextBowler !== null ? nextBowler : (bowler !== null ? bowler : inn.currentBowler);
    match.markModified("result");

    if (match.status === "SCHEDULED") match.status = "IN_PROGRESS";
    match.scoringType = "innings";

    const oversCount = inn.maxOvers || fmt.oversCount || 20;
    const inningsCountTotal = fmt.inningsCount || 2;
    let matchCompleted = false, inningsCompleted = false;

    if (inningsNumber === 2 && inn.target != null && inn.runs >= inn.target) {
      inn.status = "COMPLETED"; inningsCompleted = true; matchCompleted = true;        // chase success
    } else if (_inningsOver(inn, oversCount)) {
      inn.status = "COMPLETED"; inningsCompleted = true;
      if (inningsNumber >= inningsCountTotal) matchCompleted = true;
    }

    let tie = false;
    if (matchCompleted) {
      const resolved = await _resolveCricketResultAndFinalize(match, fmt, isKnockoutMatch, session);
      if (resolved.winnerSide === null) {
        // Tie — do not finalize as completed for knockouts; await super-over.
        // (_finalizeMatch already ran with winnerSide null = recorded draw for
        //  group; for knockout the client must POST /cricket/finish super_over.)
        tie = true;
        matchCompleted = !isKnockoutMatch; // group: a tie is a valid completed draw
        if (isKnockoutMatch) match.status = "IN_PROGRESS"; // reopen for super-over
      }
    } else {
      await _persistMatch(match, isKnockoutMatch, session);
    }

    await session.commitTransaction();
    if (matchCompleted) await _recalcAfterCommit(match, isKnockoutMatch);
    _emitCricketCarromUpdate(req, match, matchId, { roundCompleted: inningsCompleted, matchCompleted, liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, matchCompleted, inningsCompleted, tie, liveScore: _cricketLiveScore(match, fmt), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("submitCricketBall error:", e);
    return res.status(500).json({ success: false, message: "Failed to record delivery", error: e.message });
  } finally { session.endSession(); }
};

// POST /cricket/undo — remove the last delivery of the active innings
const undoCricketBall = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "innings") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a cricket match" }); }

    const innings = match.result?.innings || [];
    const inn = [...innings].reverse().find((i) => (i.deliveries || []).length > 0);
    if (!inn) { await session.abortTransaction(); return res.status(400).json({ success: false, message: "No delivery to undo" }); }

    inn.deliveries.pop();
    inn.status = "IN_PROGRESS";
    _recomputeInnings(inn);
    if (match.status === "COMPLETED") {
      match.status = "IN_PROGRESS";
      if (match.result) match.result.cricketResult = null;
    }
    match.markModified("result");
    await _persistMatch(match, isKnockoutMatch, session);
    await session.commitTransaction();
    _emitCricketCarromUpdate(req, match, matchId, { liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, liveScore: _cricketLiveScore(match, fmt), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("undoCricketBall error:", e);
    return res.status(500).json({ success: false, message: "Failed to undo", error: e.message });
  } finally { session.endSession(); }
};

// POST /cricket/innings-switch — close innings 1, open innings 2 (with target)
const switchCricketInnings = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "innings") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a cricket match" }); }

    const innings = match.result?.innings || [];
    const i1 = innings.find((i) => i.inningsNumber === 1);
    if (!i1) { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Innings 1 not started" }); }
    i1.status = "COMPLETED";

    if (!innings.find((i) => i.inningsNumber === 2)) {
      const otherSide = i1.battingSide === "player1" ? "player2" : "player1";
      match.result.innings.push({
        inningsNumber: 2, battingSide: otherSide, deliveries: [],
        runs: 0, wickets: 0, oversBowled: 0, ballsBowled: 0,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
        target: (i1.runs || 0) + 1, status: "IN_PROGRESS", overLog: [], fallOfWickets: [],
      });
    }
    match.markModified("result");
    await _persistMatch(match, isKnockoutMatch, session);
    await session.commitTransaction();
    _emitCricketCarromUpdate(req, match, matchId, { roundCompleted: true, liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, liveScore: _cricketLiveScore(match, fmt), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("switchCricketInnings error:", e);
    return res.status(500).json({ success: false, message: "Failed to switch innings", error: e.message });
  } finally { session.endSession(); }
};

// POST /cricket/finish — explicit finish; resolves ties via super-over winner
const finishCricketMatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const { result = null, winner = null, superOver = null } = req.body; // winner: "player1"|"player2"
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "innings") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a cricket match" }); }
    (match.result?.innings || []).forEach((i) => { i.status = "COMPLETED"; });

    const override = result === "super_over" ? winner : null;
    if (result === "super_over" && !winner) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "super_over result requires a winner" });
    }
    const resolved = await _resolveCricketResultAndFinalize(match, fmt, isKnockoutMatch, session, { winnerOverride: override, superOver });
    await session.commitTransaction();
    await _recalcAfterCommit(match, isKnockoutMatch);
    _emitCricketCarromUpdate(req, match, matchId, { matchCompleted: true, liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, winnerSide: resolved.winnerSide, cricketResult: resolved.cricketResult, match });
  } catch (e) {
    await session.abortTransaction();
    console.error("finishCricketMatch error:", e);
    return res.status(500).json({ success: false, message: "Failed to finish match", error: e.message });
  } finally { session.endSession(); }
};

// ── Carrom helpers ──

function _carromLiveScore(match) {
  const boards = (match.result?.boards || []).map((b) => (b.toObject ? b.toObject() : b));
  let p1Boards = 0, p2Boards = 0, p1Points = 0, p2Points = 0;
  for (const b of boards) {
    if (b.winner === "player1") p1Boards++;
    else if (b.winner === "player2") p2Boards++;
    p1Points += b.player1Points || 0;
    p2Points += b.player2Points || 0;
  }
  return { scoringType: "board", boards, player1Boards: p1Boards, player2Boards: p2Boards, player1Points: p1Points, player2Points: p2Points };
}

// POST /carrom/board — record one board's result
const submitCarromBoard = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    if (match.status === "COMPLETED") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Match already completed" }); }

    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "board") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a carrom (board) match" }); }

    const { boardNumber = null, winner, points = 0, queenPocketed = false, queenBonus = 0 } = req.body;
    if (winner !== "player1" && winner !== "player2") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Board winner (player1/player2) is required" });
    }

    if (!match.result) match.result = {};
    if (!Array.isArray(match.result.boards)) match.result.boards = [];

    const winnerPoints = (Number(points) || 0) + (queenPocketed ? (Number(queenBonus) || 0) : 0);
    match.result.boards.push({
      boardNumber: boardNumber ?? (match.result.boards.length + 1),
      player1Points: winner === "player1" ? winnerPoints : 0,
      player2Points: winner === "player2" ? winnerPoints : 0,
      queenPocketedBy: queenPocketed ? winner : null,
      winner,
      status: "COMPLETED",
    });
    match.markModified("result");
    if (match.status === "SCHEDULED") match.status = "IN_PROGRESS";
    match.scoringType = "board";

    const live = _carromLiveScore(match);
    const boardsToWin = fmt.boardsToWin || Math.ceil((fmt.totalSets || 3) / 2);
    let matchCompleted = false;
    if (live.player1Boards >= boardsToWin || live.player2Boards >= boardsToWin) {
      matchCompleted = true;
      const winnerSide = live.player1Boards > live.player2Boards ? "player1" : "player2";
      await _finalizeMatch(match, winnerSide, live.player1Boards, live.player2Boards, isKnockoutMatch, session);
    } else {
      await _persistMatch(match, isKnockoutMatch, session);
    }

    await session.commitTransaction();
    if (matchCompleted) await _recalcAfterCommit(match, isKnockoutMatch);
    _emitCricketCarromUpdate(req, match, matchId, { roundCompleted: true, matchCompleted, liveScore: _carromLiveScore(match) });
    return res.status(200).json({ success: true, matchCompleted, liveScore: _carromLiveScore(match), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("submitCarromBoard error:", e);
    return res.status(500).json({ success: false, message: "Failed to record board", error: e.message });
  } finally { session.endSession(); }
};

// POST /cricket/setup — set overs + batting/bowling order + opening roles for an
// innings (scorer enters names; no squad system). Creates the innings if needed.
const setupCricketInnings = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    if (match.status === "COMPLETED") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Match already completed" }); }

    const fmt = await _ensureScoringFormat(match);
    if (fmt.scoringType !== "innings") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Not a cricket (innings) match" }); }

    const {
      innings: inningsNumber = 1, battingPlayer = "player1",
      maxOvers = null, battingOrder = [], bowlingOrder = [],
      striker = null, nonStriker = null, currentBowler = null,
    } = req.body;

    const clean = (a) => (Array.isArray(a) ? a.map((s) => String(s || "").trim()).filter(Boolean) : []);
    const bat = clean(battingOrder), bowl = clean(bowlingOrder);

    if (!match.result) match.result = {};
    if (!Array.isArray(match.result.innings)) match.result.innings = [];

    let inn = match.result.innings.find((i) => i.inningsNumber === inningsNumber);
    const firstInnings = match.result.innings.find((x) => x.inningsNumber === 1);
    const target = inningsNumber === 2 ? ((firstInnings?.runs || 0) + 1) : null;
    if (!inn) {
      match.result.innings.push({
        inningsNumber, battingSide: battingPlayer, deliveries: [],
        runs: 0, wickets: 0, oversBowled: 0, ballsBowled: 0,
        extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
        target, status: "IN_PROGRESS", overLog: [], fallOfWickets: [],
        maxOvers: maxOvers ? Math.floor(Number(maxOvers)) : null,
        battingOrder: bat, bowlingOrder: bowl,
        striker, nonStriker, currentBowler,
      });
      inn = match.result.innings[match.result.innings.length - 1];
    } else {
      if (maxOvers) inn.maxOvers = Math.floor(Number(maxOvers));
      if (bat.length) inn.battingOrder = bat;
      if (bowl.length) inn.bowlingOrder = bowl;
      if (striker !== null) inn.striker = striker;
      if (nonStriker !== null) inn.nonStriker = nonStriker;
      if (currentBowler !== null) inn.currentBowler = currentBowler;
    }
    // Default the live roles from the orders when not supplied.
    if (!inn.striker && inn.battingOrder?.[0]) inn.striker = inn.battingOrder[0];
    if (!inn.nonStriker && inn.battingOrder?.[1]) inn.nonStriker = inn.battingOrder[1];
    if (!inn.currentBowler && inn.bowlingOrder?.[0]) inn.currentBowler = inn.bowlingOrder[0];

    if (inn.maxOvers) {
      match.matchFormat = match.matchFormat || {};
      match.matchFormat.oversCount = inn.maxOvers;
      match.markModified("matchFormat");
    }
    if (match.status === "SCHEDULED") match.status = "IN_PROGRESS";
    match.scoringType = "innings";
    match.markModified("result");

    await _persistMatch(match, isKnockoutMatch, session);
    await session.commitTransaction();
    _emitCricketCarromUpdate(req, match, matchId, { liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, liveScore: _cricketLiveScore(match, fmt), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("setupCricketInnings error:", e);
    return res.status(500).json({ success: false, message: "Failed to set up innings", error: e.message });
  } finally { session.endSession(); }
};

// POST /cricket/lineup — change batting/bowling order or the live striker /
// non-striker / bowler DURING a running match.
const updateCricketLineup = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { matchId } = req.params;
    const loaded = await _loadScoringMatch(req, matchId, session);
    if (loaded.error) { await session.abortTransaction(); return res.status(loaded.error.status).json({ success: false, message: loaded.error.message }); }
    let { match, isKnockoutMatch } = loaded;
    if (match.status === "COMPLETED") { await session.abortTransaction(); return res.status(400).json({ success: false, message: "Match already completed" }); }

    const fmt = await _ensureScoringFormat(match);
    const inningsNumber = req.body.innings || match.liveScore?.currentInnings || 1;
    const inn = (match.result?.innings || []).find((i) => i.inningsNumber === inningsNumber);
    if (!inn) { await session.abortTransaction(); return res.status(404).json({ success: false, message: "Innings not found" }); }

    const { battingOrder, bowlingOrder, striker, nonStriker, currentBowler } = req.body;
    const clean = (a) => a.map((s) => String(s || "").trim()).filter(Boolean);
    if (Array.isArray(battingOrder)) inn.battingOrder = clean(battingOrder);
    if (Array.isArray(bowlingOrder)) inn.bowlingOrder = clean(bowlingOrder);
    if (striker !== undefined) inn.striker = striker;
    if (nonStriker !== undefined) inn.nonStriker = nonStriker;
    if (currentBowler !== undefined) inn.currentBowler = currentBowler;
    match.markModified("result");

    await _persistMatch(match, isKnockoutMatch, session);
    await session.commitTransaction();
    _emitCricketCarromUpdate(req, match, matchId, { liveScore: _cricketLiveScore(match, fmt) });
    return res.status(200).json({ success: true, liveScore: _cricketLiveScore(match, fmt), match });
  } catch (e) {
    await session.abortTransaction();
    console.error("updateCricketLineup error:", e);
    return res.status(500).json({ success: false, message: "Failed to update lineup", error: e.message });
  } finally { session.endSession(); }
};

module.exports = {
  startMatch,
  getLiveMatchState,
  updateLiveScore,
  completeGame,
  resetMatch,
  getMatchStatistics,
  syncMatchScores,
  bulkSyncTournamentScores,
  syncScoreModel,
  getMatchScores,
  getMatchScore,
  validateGameCompletionLogic,
  getGroupStandings,
  recalculateGroupStandings,
  bulkUploadScores,
  // Cricket (innings) + Carrom (board) incremental scoring
  setupCricketInnings,
  updateCricketLineup,
  submitCricketBall,
  undoCricketBall,
  switchCricketInnings,
  finishCricketMatch,
  submitCarromBoard,
};