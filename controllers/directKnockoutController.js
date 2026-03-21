const mongoose = require("mongoose");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const Tournament = require("../Modal/Tournament");
const TopPlayers = require("../Modal/TopPlayers");

// 🎯 Power of 2 Validation - The Foundation
const isPowerOfTwo = (n) => {
  return n > 0 && (n & (n - 1)) === 0;
};

const getValidTournamentSizes = () => {
  return [16, 32, 64]; // Practical tournament sizes
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

    // Validate all players exist in TopPlayers collection
    const topPlayersGroups = await TopPlayers.find({ tournamentId });

    // Flatten all top players like in getTopPlayersByTournament
    const allTopPlayers = topPlayersGroups.flatMap(group => {
      const playersList = (group.players && group.players.length > 0) ? group.players : group.topPlayers;
      return playersList || [];
    });

    // Validate each selected player exists in top players
    const validPlayers = [];
    for (const selectedPlayer of selectedPlayers) {
      const found = allTopPlayers.find(topPlayer =>
        (topPlayer._id && topPlayer._id.toString() === (selectedPlayer.playerId || '').toString()) ||
        (topPlayer.playerId && topPlayer.playerId.toString() === (selectedPlayer.playerId || '').toString()) ||
        (topPlayer.playerName === selectedPlayer.userName) ||
        (topPlayer.userName === selectedPlayer.userName)
      );

      if (found) {
        validPlayers.push(found);
      }
    }

    if (validPlayers.length !== selectedPlayers.length) {
      return res.status(400).json({
        success: false,
        message: "Some selected players are not in the top players list",
        validPlayerCount: validPlayers.length,
        requestedPlayerCount: selectedPlayers.length,
        debug: {
          selectedPlayers: selectedPlayers.map(p => ({ playerId: p.playerId, userName: p.userName })),
          availableTopPlayers: allTopPlayers.length
        }
      });
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

    // Check pending matches in DB to offset Round numbering if needed
    // Assuming this create function initiates a new Phase or resets.
    // If it appends, we should be careful. Usually "Direct Knockout" is a phase.
    // For now we assume we start at R1 or append to existing.
    const lastMatchInDB = await DirectKnockoutMatch.findOne({ tournamentId }).sort({ roundNumber: -1 });
    const roundOffset = lastMatchInDB ? lastMatchInDB.roundNumber : 0;

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

    // Second pass: Handle Byes (Automatic Progression)
    // Only for Round 1 (or any round where a player is missing initially, but usually Round 1)
    for (const matchDoc of allMatchDocs) {
      if (matchDoc.roundNumber === 1 + roundOffset) {
        const p1 = matchDoc.player1;
        const p2 = matchDoc.player2;

        // Bye scenarios
        // 1. P1 present, P2 null -> P1 Bye
        // 2. P1 null, P2 present -> P2 Bye (Unlikely with standard seeding but possible)
        // 3. Both null? (Shouldn't happen with correct logic)

        let winner = null;
        if (p1.playerId && !p2.playerId) {
          winner = p1;
          matchDoc.status = "COMPLETED";
          matchDoc.winner = winner;
        } else if (!p1.playerId && p2.playerId) {
          winner = p2;
          matchDoc.status = "COMPLETED";
          matchDoc.winner = winner;
        }

        if (winner && matchDoc.nextMatchId) {
          // Find next match to update
          const nextMatch = allMatchDocs.find(m => m.matchId === matchDoc.nextMatchId);
          if (nextMatch) {
            // Determine slot: Odd match num -> p1, Even -> p2
            const isOdd = matchDoc.matchNumber % 2 !== 0;
            if (isOdd) {
              nextMatch.player1 = winner;
            } else {
              nextMatch.player2 = winner;
            }
          }
        }
      }
    }

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

    // Find winner info from TopPlayers collection
    const topPlayersGroups = await TopPlayers.find({ tournamentId: match.tournamentId });
    const allTopPlayers = topPlayersGroups.flatMap(group => {
      const playersList = (group.players && group.players.length > 0) ? group.players : group.topPlayers;
      return playersList || [];
    });

    const winner = allTopPlayers.find(player =>
      (player._id && player._id.toString() === winnerId.toString()) ||
      (player.playerId && player.playerId.toString() === winnerId.toString())
    );

    if (!winner) {
      return { success: false, message: "Winner not found in top players list" };
    }

    // Determine which player slot to fill in next match
    // Deterministic logic: Odd match number -> player1, Even match number -> player2
    const isOddMatch = match.matchNumber % 2 !== 0;
    const playerSlot = isOddMatch ? 'player1' : 'player2';

    nextMatch[playerSlot] = {
      playerId: winnerId,
      playerName: winner.playerName || winner.userName
    };

    // Set status to SCHEDULED if both players are present? Or keep as SCHEDULED.
    // Ideally if both are present, it's ready.

    await nextMatch.save();

    return {
      success: true,
      nextMatchId: nextMatch.matchId,
      targetSlot: playerSlot,
      winnerName: winner.playerName || winner.userName
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

module.exports = {
  validatePlayerSelection,
  createDirectKnockoutMatches,
  getDirectKnockoutMatches,
  progressWinnerToNextMatch,
  processDirectKnockoutProgression, // Exporting the helper!
  // Utility functions
  isPowerOfTwo,
  getValidTournamentSizes
};