/**
 * PlayerStatsController — Career stats, tournament history, and ranking for a player.
 *
 * Aggregates data across ALL tournaments a player has participated in.
 * Calculates: total matches, wins, losses, draws, win rate, rank, sport-wise breakdown.
 */

const Match = require("../Modal/Tournnamentmatch");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const SuperMatch = require("../Modal/SuperMatch");
const Booking = require("../Modal/BookingModel");
const Tournament = require("../Modal/Tournament");
const GroupStandings = require("../Modal/GroupStandings");
const User = require("../Modal/User");

/**
 * GET /player-stats/:userId
 * Returns complete career stats for a player
 */
exports.getPlayerCareerStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("name profileImage").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Find all tournaments this player has booked into
    const bookings = await Booking.find({ userId, status: { $ne: "cancelled" } })
      .populate("tournamentId", "title sportsType type startDate endDate currentStage")
      .sort({ createdAt: -1 })
      .lean();

    const tournamentIds = bookings.map((b) => b.tournamentId?._id).filter(Boolean);

    // Aggregate match stats across all match schemas
    let totalMatches = 0, totalWins = 0, totalLosses = 0, totalDraws = 0;
    const sportStats = {}; // { "Cricket": { matches, wins, losses, draws }, ... }
    const tournamentHistory = []; // detailed per-tournament history

    for (const booking of bookings) {
      const t = booking.tournamentId;
      if (!t) continue;

      const sport = t.sportsType || "Unknown";
      if (!sportStats[sport]) sportStats[sport] = { matches: 0, wins: 0, losses: 0, draws: 0 };

      let tMatches = 0, tWins = 0, tLosses = 0, tDraws = 0;

      // Check GroupStandings for this player in this tournament
      const standings = await GroupStandings.find({
        tournamentId: t._id,
        "playerId": userId,
      }).lean();

      if (standings.length > 0) {
        for (const s of standings) {
          tMatches += s.played || 0;
          tWins += s.won || 0;
          tLosses += s.lost || 0;
          tDraws += s.drawn || 0;
        }
      }

      // Also check direct match results (Match, DirectKnockoutMatch, SuperMatch)
      if (tMatches === 0) {
        // GroupStandings didn't have data — check matches directly
        const playerIdStr = userId.toString();

        // Group stage matches
        const groupMatches = await Match.find({
          tournamentId: t._id,
          status: { $in: ["COMPLETED", "completed"] },
          $or: [
            { "player1.playerId": userId },
            { "player2.playerId": userId },
          ],
        }).lean();

        for (const m of groupMatches) {
          tMatches++;
          const winnerId = m.result?.winner?.playerId?.toString() || m.winner?.playerId?.toString();
          if (!winnerId) { tDraws++; }
          else if (winnerId === playerIdStr) { tWins++; }
          else { tLosses++; }
        }

        // Direct knockout matches
        const dkMatches = await DirectKnockoutMatch.find({
          tournamentId: t._id,
          status: "COMPLETED",
          $or: [
            { "player1.playerId": userId },
            { "player2.playerId": userId },
          ],
        }).lean();

        for (const m of dkMatches) {
          tMatches++;
          const winnerId = m.result?.winner?.playerId?.toString();
          if (!winnerId) { tDraws++; }
          else if (winnerId === playerIdStr) { tWins++; }
          else { tLosses++; }
        }

        // Super matches
        const superMatches = await SuperMatch.find({
          tournamentId: t._id,
          status: "COMPLETED",
          $or: [
            { "player1.playerId": userId },
            { "player2.playerId": userId },
          ],
        }).lean();

        for (const m of superMatches) {
          tMatches++;
          const winnerId = m.winner?.playerId?.toString();
          if (!winnerId) { tDraws++; }
          else if (winnerId === playerIdStr) { tWins++; }
          else { tLosses++; }
        }
      }

      // Accumulate totals
      totalMatches += tMatches;
      totalWins += tWins;
      totalLosses += tLosses;
      totalDraws += tDraws;

      sportStats[sport].matches += tMatches;
      sportStats[sport].wins += tWins;
      sportStats[sport].losses += tLosses;
      sportStats[sport].draws += tDraws;

      // Determine what stage the player reached
      let stageReached = "Registered";
      if (tMatches > 0) stageReached = "Group Stage";
      // Check if player made it to knockout
      const inKnockout = await DirectKnockoutMatch.findOne({
        tournamentId: t._id,
        $or: [{ "player1.playerId": userId }, { "player2.playerId": userId }],
      }).lean();
      if (inKnockout) stageReached = "Knockout";

      const inFinal = await DirectKnockoutMatch.findOne({
        tournamentId: t._id,
        round: { $in: ["final", "Final"] },
        $or: [{ "player1.playerId": userId }, { "player2.playerId": userId }],
      }).lean();
      if (inFinal) stageReached = "Final";

      // Check if champion
      if (inFinal) {
        const finalWinner = inFinal.result?.winner?.playerId?.toString();
        if (finalWinner === userId.toString()) stageReached = "Champion";
      }

      tournamentHistory.push({
        tournamentId: t._id,
        title: t.title,
        sport: t.sportsType,
        type: t.type,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.currentStage,
        matches: tMatches,
        wins: tWins,
        losses: tLosses,
        draws: tDraws,
        winRate: tMatches > 0 ? Math.round((tWins / tMatches) * 100) : 0,
        stageReached,
      });
    }

    const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

    res.json({
      success: true,
      player: { _id: userId, name: user.name, profileImage: user.profileImage },
      career: {
        totalTournaments: bookings.length,
        totalMatches,
        totalWins,
        totalLosses,
        totalDraws,
        winRate,
        championships: tournamentHistory.filter((t) => t.stageReached === "Champion").length,
        finals: tournamentHistory.filter((t) => t.stageReached === "Final" || t.stageReached === "Champion").length,
      },
      sportStats: Object.entries(sportStats).map(([sport, stats]) => ({
        sport,
        ...stats,
        winRate: stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0,
      })),
      tournamentHistory,
    });
  } catch (err) {
    console.error("[PLAYER_STATS] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /player-stats/ranking/:sport?
 * Returns global player rankings (optionally filtered by sport)
 */
exports.getGlobalRankings = async (req, res) => {
  try {
    const { sport } = req.params;
    const { limit: queryLimit } = req.query;
    const maxResults = parseInt(queryLimit) || 50;

    // Get all users who have bookings
    const bookings = await Booking.find({ status: { $ne: "cancelled" } })
      .populate("tournamentId", "sportsType")
      .select("userId tournamentId")
      .lean();

    // Filter by sport if specified
    const filteredBookings = sport
      ? bookings.filter((b) => b.tournamentId?.sportsType?.toLowerCase() === sport.toLowerCase())
      : bookings;

    // Group by userId
    const playerTournaments = {};
    for (const b of filteredBookings) {
      const uid = b.userId?.toString();
      if (!uid) continue;
      if (!playerTournaments[uid]) playerTournaments[uid] = new Set();
      if (b.tournamentId?._id) playerTournaments[uid].add(b.tournamentId._id.toString());
    }

    // For each player, get basic win stats from GroupStandings
    const rankings = [];
    for (const [uid, tournamentSet] of Object.entries(playerTournaments)) {
      const tIds = Array.from(tournamentSet);

      const standings = await GroupStandings.find({
        tournamentId: { $in: tIds },
        playerId: uid,
      }).lean();

      let matches = 0, wins = 0, losses = 0, draws = 0;
      for (const s of standings) {
        matches += s.played || 0;
        wins += s.won || 0;
        losses += s.lost || 0;
        draws += s.drawn || 0;
      }

      const user = await User.findById(uid).select("name profileImage").lean();
      if (!user) continue;

      rankings.push({
        userId: uid,
        name: user.name,
        profileImage: user.profileImage,
        tournaments: tIds.length,
        matches,
        wins,
        losses,
        draws,
        winRate: matches > 0 ? Math.round((wins / matches) * 100) : 0,
        points: (wins * 3) + draws, // Simple ranking points
      });
    }

    // Sort by points → win rate → total wins
    rankings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.wins - a.wins;
    });

    // Assign ranks
    rankings.forEach((r, i) => { r.rank = i + 1; });

    res.json({
      success: true,
      sport: sport || "all",
      total: rankings.length,
      rankings: rankings.slice(0, maxResults),
    });
  } catch (err) {
    console.error("[GLOBAL_RANKINGS] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
