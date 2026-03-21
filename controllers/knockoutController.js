const KnockoutMatch = require("../Modal/KnockoutMatch");
const Tournament = require("../Modal/Tournament");
const User = require("../Modal/User");
const mongoose = require("mongoose");

// Get knockout matches by tournament and type
exports.getKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { matchType, round, category } = req.query;

    let query = { tournamentId };

    if (matchType) {
      query.matchType = matchType;
    }
    if (round) {
      query.round = parseInt(round);
    }
    if (category) {
      query.category = category;
    }

    const matches = await KnockoutMatch.find(query)
      .populate('player1.playerId', 'name profileImage playerType')
      .populate('player2.playerId', 'name profileImage playerType')
      .populate('referee.refereeId', 'name profileImage')
      .sort({ round: 1, bracketPosition: 1 });

    res.status(200).json({
      success: true,
      matches,
      total: matches.length
    });

  } catch (error) {
    console.error("Error fetching knockout matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch knockout matches",
      error: error.message
    });
  }
};

// Get specific knockout match by ID
exports.getKnockoutMatchById = async (req, res) => {
  try {
    const { matchId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    const match = await KnockoutMatch.findById(matchId)
      .populate('player1.playerId', 'name profileImage playerType seedRank nationalRanking')
      .populate('player2.playerId', 'name profileImage playerType seedRank nationalRanking')
      .populate('referee.refereeId', 'name profileImage contact')
      .populate('tournamentId', 'title type currentStage');

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    res.status(200).json({
      success: true,
      match
    });

  } catch (error) {
    console.error("Error fetching knockout match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch match",
      error: error.message
    });
  }
};

// Update knockout match result
exports.updateKnockoutMatchResult = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { winnerId, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID"
      });
    }

    const match = await KnockoutMatch.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }

    // Validate winner
    const isPlayer1 = match.player1.playerId.toString() === winnerId;
    const isPlayer2 = match.player2.playerId.toString() === winnerId;

    if (!isPlayer1 && !isPlayer2) {
      return res.status(400).json({
        success: false,
        message: "Winner must be one of the match participants"
      });
    }

    // Update match result
    const winner = isPlayer1 ? match.player1 : match.player2;

    match.winner = {
      playerId: winner.playerId,
      playerName: winner.playerName,
      playerType: winner.playerType
    };
    match.status = status || "COMPLETED";
    match.updatedAt = new Date();

    await match.save();

    // If this match has a nextMatch reference, update that match
    if (match.nextMatch && match.nextMatch.matchId) {
      await updateNextRoundMatch(match.nextMatch.matchId, match.nextMatch.position, winner);
    }

    res.status(200).json({
      success: true,
      message: "Match result updated successfully",
      match
    });

  } catch (error) {
    console.error("Error updating knockout match result:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update match result",
      error: error.message
    });
  }
};

// Helper function to update next round match with winner
const updateNextRoundMatch = async (nextMatchId, position, winner) => {
  try {
    const nextMatch = await KnockoutMatch.findById(nextMatchId);
    if (!nextMatch) return;

    const updateField = position === "player1" ? "player1" : "player2";

    nextMatch[updateField] = {
      playerId: winner.playerId,
      playerName: winner.playerName,
      playerType: winner.playerType,
      seedRank: winner.seedRank || null,
      fromGroup: winner.fromGroup || null
    };

    await nextMatch.save();
    console.log(`Updated ${updateField} in next match ${nextMatchId}`);

  } catch (error) {
    console.error("Error updating next round match:", error);
  }
};

// Generate next round matches
exports.generateNextRound = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { currentRound, matchType, category } = req.body;

    // Get completed matches from current round
    const completedMatches = await KnockoutMatch.find({
      tournamentId,
      matchType,
      round: currentRound,
      status: "COMPLETED",
      category: category || { $exists: true }
    });

    const winners = completedMatches
      .filter(match => match.winner && match.winner.playerId)
      .map(match => match.winner);

    if (winners.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No winners found in current round"
      });
    }

    if (winners.length === 1) {
      // Tournament completed
      await Tournament.findByIdAndUpdate(tournamentId, {
        currentStage: "completed",
        tournamentStatus: "completed"
      });

      return res.status(200).json({
        success: true,
        message: "Tournament completed!",
        champion: winners[0]
      });
    }

    // Generate next round
    const nextRound = currentRound + 1;
    const roundNames = {
      3: "Main Knockout",
      4: "Quarterfinals",
      5: "Semifinals",
      6: "Final"
    };

    const nextRoundMatches = [];
    let bracketPosition = 1;

    for (let i = 0; i < winners.length; i += 2) {
      const player1 = winners[i];
      const player2 = winners[i + 1];

      // Handle odd number of winners
      if (!player2) {
        // Give bye to last player
        const byeMatch = new KnockoutMatch({
          tournamentId,
          matchType,
          round: nextRound,
          roundName: roundNames[nextRound] || `Round ${nextRound}`,
          bracketPosition,
          player1: {
            playerId: player1.playerId,
            playerName: player1.playerName,
            playerType: player1.playerType
          },
          player2: {
            playerId: new mongoose.Types.ObjectId(),
            playerName: "BYE",
            playerType: "general"
          },
          category: category || "Open",
          status: "BYE",
          isBye: true,
          winner: {
            playerId: player1.playerId,
            playerName: player1.playerName,
            playerType: player1.playerType
          },
          scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          scheduledTime: {
            startTime: "10:00",
            endTime: "11:00"
          }
        });

        await byeMatch.save();
        nextRoundMatches.push(byeMatch);
      } else {
        // Regular match
        const match = new KnockoutMatch({
          tournamentId,
          matchType,
          round: nextRound,
          roundName: roundNames[nextRound] || `Round ${nextRound}`,
          bracketPosition,
          player1: {
            playerId: player1.playerId,
            playerName: player1.playerName,
            playerType: player1.playerType
          },
          player2: {
            playerId: player2.playerId,
            playerName: player2.playerName,
            playerType: player2.playerType
          },
          category: category || "Open",
          status: "SCHEDULED",
          isBye: false,
          scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          scheduledTime: {
            startTime: "10:00",
            endTime: "11:00"
          }
        });

        await match.save();
        nextRoundMatches.push(match);
      }

      bracketPosition++;
    }

    res.status(201).json({
      success: true,
      message: `Round ${nextRound} matches generated successfully`,
      round: nextRound,
      roundName: roundNames[nextRound] || `Round ${nextRound}`,
      matches: nextRoundMatches,
      totalMatches: nextRoundMatches.length
    });

  } catch (error) {
    console.error("Error generating next round:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate next round",
      error: error.message
    });
  }
};

// Get tournament bracket overview
exports.getTournamentBracket = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Get all knockout matches grouped by round
    const allMatches = await KnockoutMatch.find({ tournamentId })
      .populate('player1.playerId', 'name profileImage playerType')
      .populate('player2.playerId', 'name profileImage playerType')
      .sort({ round: 1, bracketPosition: 1 });

    // Group matches by round and type
    const bracket = {
      qualifierKnockout: {},
      mainKnockout: {}
    };

    allMatches.forEach(match => {
      const roundKey = `round${match.round}`;

      if (!bracket[match.matchType][roundKey]) {
        bracket[match.matchType][roundKey] = {
          round: match.round,
          roundName: match.roundName,
          matches: []
        };
      }

      bracket[match.matchType][roundKey].matches.push(match);
    });

    res.status(200).json({
      success: true,
      tournament: {
        id: tournament._id,
        title: tournament.title,
        currentStage: tournament.currentStage,
        tournamentStatus: tournament.tournamentStatus
      },
      bracket
    });

  } catch (error) {
    console.error("Error fetching tournament bracket:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tournament bracket",
      error: error.message
    });
  }
};

module.exports = {
  getKnockoutMatches: exports.getKnockoutMatches,
  getKnockoutMatchById: exports.getKnockoutMatchById,
  updateKnockoutMatchResult: exports.updateKnockoutMatchResult,
  generateNextRound: exports.generateNextRound,
  getTournamentBracket: exports.getTournamentBracket
};