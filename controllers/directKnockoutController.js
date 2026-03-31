const mongoose = require("mongoose");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const Tournament = require("../Modal/Tournament");
const TopPlayers = require("../Modal/TopPlayers");

// 🎯 Power of 2 Validation - The Foundation
const isPowerOfTwo = (n) => {
  return n > 0 && (n & (n - 1)) === 0;
};

const getValidTournamentSizes = () => {
  return [16, 32, 64]; // Supported bracket sizes
};

// 🔥 Validate Player Selection for Direct Knockout
const validatePlayerSelection = async (req, res) => {
  try {
    const { tournamentId, selectedPlayers } = req.body;

    if (!tournamentId || !Array.isArray(selectedPlayers)) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and selected players array are required"
      });
    }

    const playerCount = selectedPlayers.length;
    const validSizes = getValidTournamentSizes();

    // Check if count is acceptable (we will handle non-power-of-2 by rounding up)
    if (playerCount < 2) {
      return res.status(400).json({
        success: false,
        message: "Tournament requires at least 2 players."
      });
    }

    // Validate players exist — check TopPlayers first, fallback to accepting all
    // (supports both post-group and standalone flows)
    const topPlayersGroups = await TopPlayers.find({ tournamentId });
    const allTopPlayers = topPlayersGroups.flatMap(group => {
      const playersList = (group.players && group.players.length > 0) ? group.players : group.topPlayers;
      return playersList || [];
    });

    // If TopPlayers exist, validate against them. Otherwise skip validation (standalone mode).
    if (allTopPlayers.length > 0) {
      const validPlayers = [];
      for (const selectedPlayer of selectedPlayers) {
        const found = allTopPlayers.find(topPlayer =>
          (topPlayer._id && topPlayer._id.toString() === (selectedPlayer.playerId || '').toString()) ||
          (topPlayer.playerId && topPlayer.playerId.toString() === (selectedPlayer.playerId || '').toString()) ||
          (topPlayer.playerName === selectedPlayer.userName) ||
          (topPlayer.userName === selectedPlayer.userName)
        );
        if (found) validPlayers.push(found);
      }

      if (validPlayers.length !== selectedPlayers.length) {
        return res.status(400).json({
          success: false,
          message: `Some selected players are not in the top players list (${validPlayers.length}/${selectedPlayers.length} matched)`,
          validPlayerCount: validPlayers.length,
          requestedPlayerCount: selectedPlayers.length,
        });
      }
    }

    const bracketSize = getBracketSize(playerCount);
    // const validSizes = getValidTournamentSizes(); // Already declared above
    const withinLimits = validSizes.includes(bracketSize);

    if (!withinLimits) {
      return res.status(400).json({
        success: false,
        message: `Player count requires a bracket size of ${bracketSize}, but allowed sizes are: ${validSizes.join(", ")}`,
        bracketSize,
        validSizes,
        withinLimits: false
      });
    }

    return res.status(200).json({
      success: true,
      message: "Player selection is valid for Direct Knockout",
      playerCount,
      bracketSize,
      rounds: Math.log2(bracketSize),
      validSizes,
      isPowerOfTwo: playerCount === bracketSize,
      withinLimits: true
    });

  } catch (error) {
    console.error("Error validating player selection:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate player selection",
      error: error.message
    });
  }
};

// Helper to determine bracket size aligned with allowed sizes
const getBracketSize = (n) => {
  // Find smallest power of 2 >= n
  let v = 1;
  while (v < n) v *= 2;

  // Enforce minimum size of 16
  if (v < 16) return 16;

  return v;
};

// Standard Seeding logic (recursive)
const getSeedOrder = (size) => {
  let seeds = [1, 2];
  while (seeds.length < size) {
    let nextSeeds = [];
    for (let i = 0; i < seeds.length; i++) {
      nextSeeds.push(seeds[i]);
      nextSeeds.push(2 * seeds.length + 1 - seeds[i]);
    }
    seeds = nextSeeds;
  }
  return seeds;
};

// 🎪 Generate Tournament Bracket Structure with Draw Methods
const generateBracketStructure = (players, drawMethod = "global", seededPlayerIds = []) => {
  const playerCount = players.length;
  const bracketSize = getBracketSize(playerCount);
  const totalRounds = Math.log2(bracketSize);

  // 1. Arrange Players by Seed
  // If seededPlayerIds are provided, they take spots 1..K. Rest are K+1..N.
  let rankedPlayers = []; // index 0 = Rank 1, index 1 = Rank 2...

  if (seededPlayerIds && seededPlayerIds.length > 0) {
    const seeds = seededPlayerIds.map(id => players.find(p =>
      (p.playerId && p.playerId.toString() === id.toString()) ||
      (p._id && p._id.toString() === id.toString()) ||
      (p.id && p.id.toString() === id.toString())
    )).filter(Boolean);

    const seededIdsSet = new Set(seeds.map(p => (p.playerId || p._id || p.id).toString()));
    const unseeded = players.filter(p => !seededIdsSet.has((p.playerId || p._id || p.id).toString()));

    rankedPlayers = [...seeds, ...unseeded];
  } else {
    // If no explicit seeds, assume input order determines rank (or input is already sorted)
    rankedPlayers = [...players];
  }

  // 2. Get Standard Seeding Order
  const seedOrder = getSeedOrder(bracketSize);

  const bracket = [];

  // Determine round names helper
  const getRoundName = (roundNumber, total) => {
    const roundsFromEnd = total - roundNumber + 1;
    if (roundsFromEnd === 1) return "final";
    if (roundsFromEnd === 2) return "semi-final";
    if (roundsFromEnd === 3) return "quarter-final";
    if (roundsFromEnd === 4) return "round-of-16";
    if (roundsFromEnd === 5) return "round-of-32";
    if (roundsFromEnd === 6) return "round-of-64";
    if (roundsFromEnd === 7) return "round-of-128";
    return `round-${roundNumber}`;
  };

  // 3. Generate Rounds
  for (let r = 1; r <= totalRounds; r++) {
    const roundName = getRoundName(r, totalRounds);
    const numMatches = bracketSize / Math.pow(2, r);
    const roundMatches = [];

    for (let m = 0; m < numMatches; m++) {
      if (r === 1) {
        // First round: Populate with actual players using Seed Order
        // Match 1: seedOrder[0] vs seedOrder[1]
        // Match m: seedOrder[2*m] vs seedOrder[2*m+1]

        const seed1 = seedOrder[m * 2];
        const seed2 = seedOrder[m * 2 + 1];

        // Players are 1-based in seedOrder, but 0-based in rankedPlayers
        // If seed index > actual player count, it's a BYE
        const p1 = (seed1 <= playerCount) ? rankedPlayers[seed1 - 1] : null;
        const p2 = (seed2 <= playerCount) ? rankedPlayers[seed2 - 1] : null;

        roundMatches.push({
          round: roundName,
          roundNumber: r,
          matchNumber: m + 1,
          player1: p1,
          player2: p2,
          bracketPosition: `R${r}M${m + 1}`
        });
      } else {
        // Subsequent rounds: Empty slots (winners from previous round)
        roundMatches.push({
          round: roundName,
          roundNumber: r,
          matchNumber: m + 1,
          player1: null,
          player2: null,
          bracketPosition: `R${r}M${m + 1}`
        });
      }
    }

    bracket.push({
      roundNumber: r,
      roundName,
      matches: roundMatches
    });
  }

  return bracket;
};

// 🚀 Create Direct Knockout Matches
const createDirectKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId, selectedPlayers, schedule, drawMethod, seededPlayers } = req.body; // Extract new params

    // Validate inputs
    if (!tournamentId || !selectedPlayers || !schedule) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID, selected players, and schedule are required"
      });
    }

    // Validate tournament exists and get dynamic match format settings
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Validate: player count must exactly match draw size
    const requestedDraw = schedule?.drawSize || getBracketSize(selectedPlayers.length);
    if (getValidTournamentSizes().includes(requestedDraw) && selectedPlayers.length !== requestedDraw) {
      return res.status(400).json({
        success: false,
        message: `Player count (${selectedPlayers.length}) must exactly match draw size (${requestedDraw}). Select exactly ${requestedDraw} players.`,
      });
    }

    // Extract dynamic match format from tournament settings (like SuperMatch!)
    const matchFormat = tournament.matchFormat || {
      setsToWin: 3,
      maxSets: 5,
      gamesToWin: 3,
      maxGames: 5,
      pointsToWinGame: 11,
      marginToWin: 2,
      deuceRule: true,
      maxPointsPerGame: null,
      serviceRule: {
        pointsPerService: 2,
        deuceServicePoints: 1
      }
    };

    // Generate bracket structure for ALL rounds
    const bracket = generateBracketStructure(selectedPlayers, drawMethod, seededPlayers);
    const totalRounds = bracket.length;

    // Clear any existing direct knockout matches for this tournament to prevent duplicates
    const existingCount = await DirectKnockoutMatch.countDocuments({ tournamentId });
    if (existingCount > 0) {
      await DirectKnockoutMatch.deleteMany({ tournamentId });
      console.log(`[DK] Cleared ${existingCount} existing matches for tournament ${tournamentId}`);
    }

    const roundOffset = 0;
    let allMatchDocs = [];

    // First pass: Create all match objects with IDs
    for (const round of bracket) {
      for (let i = 0; i < round.matches.length; i++) {
        const match = round.matches[i];
        const dbRoundNumber = round.roundNumber + roundOffset;
        const matchId = `DK-${tournamentId}-R${dbRoundNumber}-M${match.matchNumber}`;

        // Calculate Next Match ID
        let nextMatchId = null;
        if (round.roundNumber < totalRounds) {
          const nextRound = dbRoundNumber + 1;
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchId = `DK-${tournamentId}-R${nextRound}-M${nextMatchNum}`;
        }

        // Parse schedule time (Base time)
        // Adjust time for rounds? Or all same day? 
        // Simple logic: Round 1 matches spread by interval. Round 2 matches later?
        // Current logic spreads matches linearly

        // We'll calculate time index cumulatively across rounds
        const matchesBefore = allMatchDocs.length;

        // Date parsing
        let baseDateTime;
        if (schedule.startDate && schedule.startTime && !schedule.startTime.includes('T')) {
          baseDateTime = new Date(`${schedule.startDate}T${schedule.startTime}`);
        } else if (schedule.startTime) {
          baseDateTime = new Date(schedule.startTime);
        } else {
          baseDateTime = new Date();
        }
        if (isNaN(baseDateTime.getTime())) baseDateTime = new Date();

        const matchStartTime = new Date(baseDateTime.getTime() + (matchesBefore * schedule.intervalMinutes * 60000));

        allMatchDocs.push({
          tournamentId,
          matchId,
          round: match.round,
          roundNumber: dbRoundNumber,
          matchNumber: match.matchNumber,
          player1: match.player1 ? {
            playerId: match.player1.playerId,
            playerName: match.player1.userName
          } : { playerId: null, playerName: "TBD" },
          player2: match.player2 ? {
            playerId: match.player2.playerId,
            playerName: match.player2.userName
          } : { playerId: null, playerName: "TBD" },
          courtNumber: schedule.courtNumber || 1,
          matchStartTime,
          nextMatchId,
          bracketPosition: match.bracketPosition,
          status: "SCHEDULED",
          winner: null,
          matchFormat: {
            setsToWin: matchFormat.setsToWin,
            maxSets: matchFormat.maxSets,
            gamesToWin: matchFormat.gamesToWin,
            maxGames: matchFormat.maxGames,
            pointsToWinGame: matchFormat.pointsToWinGame,
            marginToWin: matchFormat.marginToWin,
            deuceRule: matchFormat.deuceRule,
            maxPointsPerGame: matchFormat.maxPointsPerGame,
            serviceRule: matchFormat.serviceRule
          }
        });
      }
    }

    // No auto-BYEs — player count must exactly match draw size
    // BYEs are given manually after match generation via the giveBye endpoint

    // Save all matches
    const savedMatches = await DirectKnockoutMatch.insertMany(allMatchDocs);

    // Update tournament to direct knockout mode
    await Tournament.findByIdAndUpdate(tournamentId, {
      roundTwoMode: "direct-knockout"
    });

    return res.status(201).json({
      success: true,
      message: "Direct Knockout matches created successfully",
      tournament: {
        id: tournamentId,
        mode: "direct-knockout"
      },
      bracket: {
        totalRounds: bracket.length,
        totalMatches: savedMatches.length,
        playerCount: selectedPlayers.length
      },
      matches: savedMatches,
      schedule: {
        startTime: `${schedule.startDate}T${schedule.startTime}`,
        court: schedule.courtNumber || schedule.courtNumbers || 1,
        interval: schedule.intervalMinutes
      }
    });

  } catch (error) {
    console.error("Error creating Direct Knockout matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create Direct Knockout matches",
      error: error.message
    });
  }
};

// 📊 Get Direct Knockout Matches for Tournament
const getDirectKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID is required"
      });
    }

    const matches = await DirectKnockoutMatch.find({ tournamentId })
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .sort({ roundNumber: 1, matchNumber: 1 });

    // Group matches by round for easier frontend handling
    const matchesByRound = matches.reduce((acc, match) => {
      if (!acc[match.round]) {
        acc[match.round] = [];
      }
      acc[match.round].push(match);
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      tournament: tournamentId,
      mode: "direct-knockout",
      totalMatches: matches.length,
      rounds: Object.keys(matchesByRound).length,
      matches,
      matchesByRound
    });

  } catch (error) {
    console.error("Error fetching Direct Knockout matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Direct Knockout matches",
      error: error.message
    });
  }
};

// 🛠️ Helper: Process Direct Knockout Progression Logic
const processDirectKnockoutProgression = async (match, winnerId) => {
  try {
    // If we only have matchId, fetch the doc
    if (typeof match === 'string') {
      match = await DirectKnockoutMatch.findOne({ matchId: match });
    }

    if (!match || !match.nextMatchId) {
      return { success: true, message: "No next match to progress to" };
    }

    const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
    if (!nextMatch) {
      return { success: false, message: "Next match found in ID but not in DB" };
    }

    // Get winner info directly from the match (not TopPlayers — works for both standalone and post-group)
    const winnerIdStr = winnerId.toString();
    const p1Id = match.player1?.playerId?.toString();
    const p2Id = match.player2?.playerId?.toString();

    let winnerData;
    if (p1Id === winnerIdStr) {
      winnerData = { playerId: match.player1.playerId, playerName: match.player1.playerName };
    } else if (p2Id === winnerIdStr) {
      winnerData = { playerId: match.player2.playerId, playerName: match.player2.playerName };
    } else {
      return { success: false, message: "Winner ID does not match either player in this match" };
    }

    // Determine which player slot to fill in next match
    const isOddMatch = match.matchNumber % 2 !== 0;
    const playerSlot = isOddMatch ? 'player1' : 'player2';

    nextMatch[playerSlot] = {
      playerId: winnerData.playerId,
      playerName: winnerData.playerName
    };

    await nextMatch.save();

    return {
      success: true,
      nextMatchId: nextMatch.matchId,
      targetSlot: playerSlot,
      winnerName: winnerData.playerName
    };

  } catch (error) {
    console.error("Error in processDirectKnockoutProgression:", error);
    return { success: false, error: error.message };
  }
};

// 🎯 Progress Winner to Next Match (API Handler)
const progressWinnerToNextMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { winnerId } = req.body;

    if (!matchId || !winnerId) {
      return res.status(400).json({
        success: false,
        message: "Match ID and winner ID are required"
      });
    }

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Direct Knockout match not found"
      });
    }

    if (match.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Match must be completed before progressing winner"
      });
    }

    const result = await processDirectKnockoutProgression(match, winnerId);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message || "Winner progressed to next match",
        data: result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message || "Failed to progress winner",
        error: result.error
      });
    }

  } catch (error) {
    console.error("Error progressing winner:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to progress winner",
      error: error.message
    });
  }
};

// =====================================================
// STANDALONE MODE — No Group Stage Required
// =====================================================

// Validate players for standalone knockout (no TopPlayers check)
const validateStandalonePlayers = async (req, res) => {
  try {
    const { players, drawSize } = req.body;

    if (!Array.isArray(players) || players.length < 2) {
      return res.status(400).json({ success: false, message: "At least 2 players required" });
    }

    const bracketSize = drawSize || players.length;
    const validSizes = getValidTournamentSizes();

    if (!validSizes.includes(bracketSize)) {
      return res.status(400).json({
        success: false,
        message: `Draw size ${bracketSize} not supported. Use: ${validSizes.join(", ")}`,
      });
    }

    if (players.length !== bracketSize) {
      return res.status(400).json({
        success: false,
        message: `Player count (${players.length}) must exactly match draw size (${bracketSize}). Select exactly ${bracketSize} players for a ${bracketSize}-draw.`,
      });
    }

    const rounds = Math.log2(bracketSize);

    return res.json({
      success: true,
      playerCount: players.length,
      bracketSize,
      rounds,
      totalMatches: bracketSize - 1,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Create standalone knockout matches — players passed directly, no TopPlayers needed
const createStandaloneKnockout = async (req, res) => {
  try {
    const { tournamentId, players, schedule, drawSize, drawMethod, seededPlayers } = req.body;

    if (!tournamentId || !Array.isArray(players) || players.length < 2) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and at least 2 players are required",
      });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    // Validate: player count must exactly match draw size
    const selectedDraw = drawSize || players.length;
    const validSizes = getValidTournamentSizes();

    if (!validSizes.includes(selectedDraw)) {
      return res.status(400).json({
        success: false,
        message: `Draw size ${selectedDraw} not supported. Use: ${validSizes.join(", ")}`,
      });
    }

    if (players.length !== selectedDraw) {
      return res.status(400).json({
        success: false,
        message: `Player count (${players.length}) must exactly match draw size (${selectedDraw}). Select exactly ${selectedDraw} players.`,
      });
    }

    // Clear any existing direct knockout matches for this tournament
    await DirectKnockoutMatch.deleteMany({ tournamentId });

    const bracketSize = drawSize || getBracketSize(players.length);

    // Normalize player format
    const normalizedPlayers = players.map((p, i) => ({
      playerId: p.playerId || p._id || null,
      userName: p.userName || p.playerName || p.name || `Player ${i + 1}`,
    }));

    // Build match format from tournament
    const mf = tournament.matchFormat || {};
    const totalSets = mf.totalSets || mf.maxSets || 5;
    const totalGames = mf.totalGames || mf.maxGames || 5;
    const matchFormat = {
      setsToWin: mf.setsToWin || Math.ceil(totalSets / 2),
      maxSets: totalSets,
      gamesToWin: mf.gamesToWin || Math.ceil(totalGames / 2),
      maxGames: totalGames,
      pointsToWinGame: mf.pointsToWinGame || mf.pointsPerGame || 11,
      marginToWin: mf.marginToWin || 2,
      deuceRule: mf.deuceRule !== false,
      maxPointsPerGame: mf.maxPointsPerGame || null,
      serviceRule: mf.serviceRule || { pointsPerService: 2, deuceServicePoints: 1 },
    };

    // Generate bracket
    const bracket = generateBracketStructure(normalizedPlayers, drawMethod || "global", seededPlayers || []);
    const totalRounds = bracket.length;

    const sched = schedule || {};
    let baseDateTime;
    if (sched.startDate && sched.startTime) {
      baseDateTime = new Date(`${sched.startDate}T${sched.startTime}`);
    } else {
      baseDateTime = new Date();
    }
    if (isNaN(baseDateTime.getTime())) baseDateTime = new Date();
    const interval = sched.intervalMinutes || 30;
    const court = sched.courtNumber || "1";

    const allMatchDocs = [];

    for (const round of bracket) {
      for (const match of round.matches) {
        const matchId = `DK-${tournamentId}-R${round.roundNumber}-M${match.matchNumber}`;

        let nextMatchId = null;
        if (round.roundNumber < totalRounds) {
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchId = `DK-${tournamentId}-R${round.roundNumber + 1}-M${nextMatchNum}`;
        }

        const matchStartTime = new Date(baseDateTime.getTime() + allMatchDocs.length * interval * 60000);

        allMatchDocs.push({
          tournamentId,
          matchId,
          mode: "direct-knockout",
          round: match.round,
          roundNumber: round.roundNumber,
          matchNumber: match.matchNumber,
          player1: match.player1
            ? { playerId: match.player1.playerId || null, playerName: match.player1.userName || "TBD" }
            : { playerId: null, playerName: "TBD" },
          player2: match.player2
            ? { playerId: match.player2.playerId || null, playerName: match.player2.userName || "TBD" }
            : { playerId: null, playerName: "TBD" },
          courtNumber: court,
          matchStartTime,
          nextMatchId,
          bracketPosition: match.bracketPosition,
          status: "SCHEDULED",
          matchFormat,
        });
      }
    }

    // No auto-BYEs — player count must exactly match draw size
    // BYEs are given manually after generation via the giveBye endpoint

    const saved = await DirectKnockoutMatch.insertMany(allMatchDocs);

    // Update tournament
    await Tournament.findByIdAndUpdate(tournamentId, { roundTwoMode: "direct-knockout" });

    return res.status(201).json({
      success: true,
      message: `Direct Knockout bracket created: ${saved.length} matches across ${totalRounds} rounds`,
      bracket: {
        totalRounds,
        totalMatches: saved.length,
        playerCount: normalizedPlayers.length,
        bracketSize,
        byes: bracketSize - normalizedPlayers.length,
      },
      matches: saved,
    });
  } catch (err) {
    console.error("[STANDALONE_KNOCKOUT] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =====================================================
// LIVE SCORING for Direct Knockout Matches
// =====================================================

// Complete a game in a Direct Knockout match
const completeGame = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { player1Score, player2Score } = req.body;

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) return res.status(404).json({ success: false, message: "Match not found" });
    if (match.status === "COMPLETED") return res.status(400).json({ success: false, message: "Match already completed" });

    if (player1Score === player2Score) {
      return res.status(400).json({ success: false, message: "Scores cannot be tied" });
    }

    // Start match if scheduled
    if (match.status === "SCHEDULED") match.status = "IN_PROGRESS";

    const setIdx = match.currentSet - 1;

    // Ensure set exists
    if (!match.sets[setIdx]) {
      match.sets.push({
        setNumber: match.currentSet,
        status: "IN_PROGRESS",
        games: [],
      });
    }

    const currentSet = match.sets[setIdx];

    // Guard: don't allow scoring if current set is already completed
    if (currentSet.status === "COMPLETED") {
      return res.status(400).json({ success: false, message: `Set ${match.currentSet} is already completed` });
    }

    // Guard: check if set is already decided before adding game
    const gamesToWinCheck = match.matchFormat?.gamesToWin || 3;
    const existingP1Games = (currentSet.games || []).filter((g) => g.winner?.playerName === match.player1.playerName).length;
    const existingP2Games = (currentSet.games || []).filter((g) => g.winner?.playerName === match.player2.playerName).length;
    if (existingP1Games >= gamesToWinCheck || existingP2Games >= gamesToWinCheck) {
      // Set already decided — auto-advance to next set
      currentSet.status = "COMPLETED";
      const setW = existingP1Games >= gamesToWinCheck ? match.player1 : match.player2;
      currentSet.winner = { playerId: setW.playerId, playerName: setW.playerName };
      match.currentSet += 1;
      match.currentGame = 1;
      if (!match.sets[match.currentSet - 1]) {
        match.sets.push({ setNumber: match.currentSet, status: "IN_PROGRESS", games: [] });
      }
      await match.save();
      return res.status(400).json({ success: false, message: `Set ${match.currentSet - 1} was already won. Moved to Set ${match.currentSet}. Please re-submit.` });
    }

    const gameWinner = player1Score > player2Score ? "player1" : "player2";
    const winnerData = gameWinner === "player1" ? match.player1 : match.player2;

    // Add game
    currentSet.games.push({
      gameNumber: match.currentGame,
      status: "COMPLETED",
      finalScore: { player1: player1Score, player2: player2Score },
      winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
      startTime: new Date(),
      endTime: new Date(),
    });

    // Count game wins in this set
    const p1Games = currentSet.games.filter((g) => g.winner?.playerName === match.player1.playerName).length;
    const p2Games = currentSet.games.filter((g) => g.winner?.playerName === match.player2.playerName).length;

    const gamesToWin = match.matchFormat?.gamesToWin || 3;

    if (p1Games >= gamesToWin || p2Games >= gamesToWin) {
      // Set complete
      const setWinner = p1Games >= gamesToWin ? match.player1 : match.player2;
      currentSet.status = "COMPLETED";
      currentSet.winner = { playerId: setWinner.playerId, playerName: setWinner.playerName };

      // Count set wins
      const p1Sets = match.sets.filter((s) => s.winner?.playerName === match.player1.playerName).length;
      const p2Sets = match.sets.filter((s) => s.winner?.playerName === match.player2.playerName).length;

      const setsToWin = match.matchFormat?.setsToWin || 3;

      if (p1Sets >= setsToWin || p2Sets >= setsToWin) {
        // Match complete
        const matchWinner = p1Sets >= setsToWin ? match.player1 : match.player2;
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
          finalScore: { player1Sets: p1Sets, player2Sets: p2Sets },
          completedAt: new Date(),
        };

        // Auto-progress winner to next match
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const isOdd = match.matchNumber % 2 !== 0;
            const slot = isOdd ? "player1" : "player2";
            nextMatch[slot] = { playerId: matchWinner.playerId, playerName: matchWinner.playerName };
            await nextMatch.save();
          }
        }
      } else {
        // Move to next set
        match.currentSet += 1;
        match.currentGame = 1;
        match.sets.push({
          setNumber: match.currentSet,
          status: "IN_PROGRESS",
          games: [],
        });
      }
    } else {
      // Move to next game
      match.currentGame += 1;
    }

    // Update live score
    match.liveScore = { player1Points: player1Score, player2Points: player2Score };

    await match.save();

    return res.json({
      success: true,
      message: match.status === "COMPLETED" ? "Match completed!" : "Game recorded",
      match: {
        matchId: match.matchId,
        status: match.status,
        currentSet: match.currentSet,
        currentGame: match.currentGame,
        sets: match.sets,
        result: match.result,
      },
    });
  } catch (err) {
    console.error("[DK_COMPLETE_GAME] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Bulk score upload for Direct Knockout matches
const bulkUploadScores = async (req, res) => {
  try {
    const { tournamentId, scores } = req.body;

    if (!tournamentId || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ success: false, message: "tournamentId and scores array required" });
    }

    const results = [];
    const errors = [];

    for (const entry of scores) {
      const { matchId, sets: setScores } = entry;

      if (!matchId || !Array.isArray(setScores) || setScores.length === 0) {
        errors.push({ matchId, error: "matchId and sets required" });
        continue;
      }

      try {
        const match = await DirectKnockoutMatch.findOne({
          $or: [{ matchId }, { _id: mongoose.Types.ObjectId.isValid(matchId) ? matchId : undefined }].filter(Boolean),
          tournamentId,
        });

        if (!match) { errors.push({ matchId, error: "Match not found" }); continue; }
        if (match.status === "COMPLETED") { errors.push({ matchId, error: "Already completed" }); continue; }

        const setsToWin = match.matchFormat?.setsToWin || 3;
        let p1SetsWon = 0, p2SetsWon = 0;
        let matchDone = false;

        match.sets = [];
        match.status = "IN_PROGRESS";

        for (let i = 0; i < setScores.length && !matchDone; i++) {
          const s = setScores[i];
          const setWinner = s.player1Score > s.player2Score ? "player1" : "player2";
          const winnerData = setWinner === "player1" ? match.player1 : match.player2;

          match.sets.push({
            setNumber: i + 1,
            status: "COMPLETED",
            winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
            games: [
              {
                gameNumber: 1,
                status: "COMPLETED",
                finalScore: { player1: s.player1Score, player2: s.player2Score },
                winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
                startTime: new Date(),
                endTime: new Date(),
              },
            ],
          });

          if (setWinner === "player1") p1SetsWon++;
          else p2SetsWon++;

          if (p1SetsWon >= setsToWin || p2SetsWon >= setsToWin) matchDone = true;
        }

        const matchWinner = p1SetsWon >= setsToWin ? match.player1 : match.player2;
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
          finalScore: { player1Sets: p1SetsWon, player2Sets: p2SetsWon },
          completedAt: new Date(),
        };

        // Auto-progress
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const isOdd = match.matchNumber % 2 !== 0;
            const slot = isOdd ? "player1" : "player2";
            nextMatch[slot] = { playerId: matchWinner.playerId, playerName: matchWinner.playerName };
            await nextMatch.save();
          }
        }

        await match.save();

        results.push({
          matchId: match.matchId,
          player1: match.player1.playerName,
          player2: match.player2.playerName,
          winner: matchWinner.playerName,
          finalScore: `${p1SetsWon}-${p2SetsWon}`,
        });
      } catch (matchErr) {
        errors.push({ matchId, error: matchErr.message });
      }
    }

    return res.json({
      success: true,
      message: `${results.length} matches scored, ${errors.length} errors`,
      results,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Give BYE to a player in a match — the other player auto-advances
const giveBye = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { byePlayerId } = req.body; // The player who gets the BYE (loses/withdraws)

    if (!matchId || !byePlayerId) {
      return res.status(400).json({ success: false, message: "matchId and byePlayerId are required" });
    }

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) return res.status(404).json({ success: false, message: "Match not found" });
    if (match.status === "COMPLETED") return res.status(400).json({ success: false, message: "Match is already completed" });

    // Determine winner (the other player)
    const p1Id = match.player1?.playerId ? match.player1.playerId.toString() : null;
    const p2Id = match.player2?.playerId ? match.player2.playerId.toString() : null;
    const p1Name = match.player1?.playerName || "";
    const p2Name = match.player2?.playerName || "";
    const byeId = byePlayerId.toString();

    let winner, loser;
    // Match by ID or by name (fallback if playerId was not stored as ObjectId)
    if (p1Id === byeId || p1Name === byeId) {
      winner = match.player2;
      loser = match.player1;
    } else if (p2Id === byeId || p2Name === byeId) {
      winner = match.player1;
      loser = match.player2;
    } else {
      return res.status(400).json({
        success: false,
        message: "byePlayerId does not match either player in this match",
        debug: { byeId, p1Id, p2Id, p1Name, p2Name },
      });
    }

    if (!winner?.playerId) {
      return res.status(400).json({ success: false, message: "Cannot give BYE — the other player slot is empty" });
    }

    // Complete match with BYE
    match.status = "COMPLETED";
    match.result = {
      winner: { playerId: winner.playerId, playerName: winner.playerName },
      finalScore: { player1Sets: 0, player2Sets: 0 },
      matchDuration: 0,
      completedAt: new Date(),
    };
    match.notes = `BYE — ${loser.playerName} withdrew. ${winner.playerName} advances.`;

    // Auto-progress winner to next match
    if (match.nextMatchId) {
      const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
      if (nextMatch) {
        const isOdd = match.matchNumber % 2 !== 0;
        const slot = isOdd ? "player1" : "player2";
        nextMatch[slot] = { playerId: winner.playerId, playerName: winner.playerName };
        await nextMatch.save();
      }
    }

    await match.save();

    return res.json({
      success: true,
      message: `BYE given to ${loser.playerName}. ${winner.playerName} advances.`,
      match: {
        matchId: match.matchId,
        status: match.status,
        winner: winner.playerName,
        byePlayer: loser.playerName,
        nextMatchId: match.nextMatchId,
      },
    });
  } catch (err) {
    console.error("[DK_BYE] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Reset direct knockout bracket for a tournament
const resetBracket = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const deleted = await DirectKnockoutMatch.deleteMany({ tournamentId });
    return res.json({
      success: true,
      message: `Deleted ${deleted.deletedCount} matches`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  // Original (post-group stage)
  validatePlayerSelection,
  createDirectKnockoutMatches,
  getDirectKnockoutMatches,
  progressWinnerToNextMatch,
  processDirectKnockoutProgression,

  // Standalone mode
  validateStandalonePlayers,
  createStandaloneKnockout,

  // Live scoring
  completeGame,
  bulkUploadScores,
  giveBye,
  resetBracket,

  // Utilities
  isPowerOfTwo,
  getValidTournamentSizes,
};