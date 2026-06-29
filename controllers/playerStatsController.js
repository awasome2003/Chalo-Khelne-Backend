/**
 * PlayerStatsController — Career stats, tournament history, and ranking for a player.
 *
 * Aggregates data across ALL tournaments a player has participated in.
 * Calculates: total matches, wins, losses, draws, win rate, rank, sport-wise breakdown.
 */

const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../src/modules/tournaments/models/TeamKnockoutTeams");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
const User = require("../src/modules/identity/models/User");

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

    // STEP 17b.i — per-sport reads off sport-track. Falls back via
    // synthesizeLegacyTrack until 17d.
    // TODO: multi-sport breakdown — one row per sport. Currently
    // collapses to sports[0] for the per-tournament summary.
    const { getSportName, getTournamentType, getCurrentStage } = require("../utils/sportTrackUtils");

    for (const booking of bookings) {
      const t = booking.tournamentId;
      if (!t) continue;

      const sport = getSportName(t) || "Unknown";
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

        // KnockoutMatch (separate from DirectKnockoutMatch — used for bracket-style knockouts)
        const koMatches = await KnockoutMatch.find({
          tournamentId: t._id,
          status: "COMPLETED",
          $or: [
            { "player1.playerId": userId },
            { "player2.playerId": userId },
          ],
        }).lean();

        for (const m of koMatches) {
          tMatches++;
          const winnerId =
            m.winner?.playerId?.toString() ||
            m.result?.winner?.playerId?.toString();
          if (!winnerId) { tDraws++; }
          else if (winnerId === playerIdStr) { tWins++; }
          else { tLosses++; }
        }

        // Team knockout matches — dereference team roster to find player's wins/losses
        const userTeams = await TeamKnockoutTeams.find({
          tournamentId: t._id,
          "roster.userId": userId,
        }).select("_id").lean();
        const teamIds = userTeams.map((tm) => tm._id);

        if (teamIds.length > 0) {
          const teamMatches = await TeamKnockoutMatches.find({
            tournamentId: t._id,
            status: "COMPLETED",
            $or: [
              { team1Id: { $in: teamIds } },
              { team2Id: { $in: teamIds } },
            ],
          }).lean();

          const teamIdStrs = teamIds.map((id) => id.toString());
          for (const m of teamMatches) {
            tMatches++;
            const winnerId = m.winnerId?.toString();
            if (!winnerId) { tDraws++; }
            else if (teamIdStrs.includes(winnerId)) { tWins++; }
            else { tLosses++; }
          }
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
        sport: getSportName(t),
        type: getTournamentType(t),
        startDate: t.startDate,
        endDate: t.endDate,
        status: getCurrentStage(t),
        matches: tMatches,
        wins: tWins,
        losses: tLosses,
        draws: tDraws,
        winRate: tMatches > 0 ? Math.round((tWins / tMatches) * 100) : 0,
        stageReached,
      });
    }

    const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

    // Count DISTINCT tournaments (a player may have several bookings for the
    // same tournament across categories) and how many are still upcoming.
    const parseTourneyDate = (s) => {
      if (!s) return null;
      if (String(s).includes("/")) {
        const [d, m, y] = String(s).split("/").map(Number);
        return new Date(y, m - 1, d);
      }
      const dt = new Date(s);
      return isNaN(dt.getTime()) ? null : dt;
    };
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const uniqTournaments = new Map();
    for (const b of bookings) {
      const t = b.tournamentId;
      if (t && t._id) uniqTournaments.set(String(t._id), t);
    }
    const totalTournaments = uniqTournaments.size;
    let totalUpcoming = 0;
    for (const t of uniqTournaments.values()) {
      const sd = parseTourneyDate(t.startDate);
      if (sd) {
        sd.setHours(0, 0, 0, 0);
        if (sd >= startOfToday) totalUpcoming++;
      }
    }

    res.json({
      success: true,
      player: { _id: userId, name: user.name, profileImage: user.profileImage },
      career: {
        totalTournaments,
        totalUpcoming,
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
    const { limit: queryLimit, season, from, to } = req.query;
    const maxResults = parseInt(queryLimit) || 50;

    // Seasonal window: explicit ?from/to wins; else ?season=YYYY covers that
    // calendar year. Filters bookings by createdAt. Unfiltered when none set.
    let dateFilter = null;
    if (from || to) {
      dateFilter = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) dateFilter.$lte = new Date(to);
    } else if (season) {
      const y = parseInt(season);
      if (Number.isInteger(y)) {
        dateFilter = {
          $gte: new Date(`${y}-01-01T00:00:00Z`),
          $lt: new Date(`${y + 1}-01-01T00:00:00Z`),
        };
      }
    }

    const bookingFilter = { status: { $ne: "cancelled" } };
    if (dateFilter) bookingFilter.createdAt = dateFilter;

    // Get all users who have bookings (optionally within the date window)
    const bookings = await Booking.find(bookingFilter)
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
      window: dateFilter ? { season: season || null, from: from || null, to: to || null } : null,
      total: rankings.length,
      rankings: rankings.slice(0, maxResults),
    });
  } catch (err) {
    console.error("[GLOBAL_RANKINGS] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /player-stats/ranking/clubs
 * Club rankings — MVP: sorted by tournaments hosted, then players engaged, then
 * managers count. Optional date window via ?season=YYYY or ?from=&to=.
 * (N+1 over clubs; small N in practice. TODO: convert to an aggregation
 * pipeline if clubs scale into the hundreds.)
 */
exports.getClubRankings = async (req, res) => {
  try {
    const { limit: queryLimit, season, from, to } = req.query;
    const maxResults = parseInt(queryLimit) || 50;

    let dateFilter = null;
    if (from || to) {
      dateFilter = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) dateFilter.$lte = new Date(to);
    } else if (season) {
      const y = parseInt(season);
      if (Number.isInteger(y)) {
        dateFilter = {
          $gte: new Date(`${y}-01-01T00:00:00Z`),
          $lt: new Date(`${y + 1}-01-01T00:00:00Z`),
        };
      }
    }

    const Manager = require("../src/modules/identity/models/ClubManager").Manager;
    const Tournament = require("../src/modules/tournaments/models/Tournament");

    const clubs = await User.find({ role: "ClubAdmin" })
      .select("name clubName profileImage")
      .lean();

    const rankings = [];
    for (const club of clubs) {
      const managers = await Manager.find({ clubId: club._id }).select("_id").lean();
      const managerIds = managers.map((m) => m._id);
      let tournamentCount = 0;
      let players = 0;
      if (managerIds.length > 0) {
        const tFilter = { managerId: { $in: managerIds } };
        if (dateFilter) tFilter.createdAt = dateFilter;
        const tournaments = await Tournament.find(tFilter).select("_id").lean();
        tournamentCount = tournaments.length;
        if (tournamentCount > 0) {
          players = await Booking.countDocuments({
            tournamentId: { $in: tournaments.map((t) => t._id) },
            status: { $ne: "cancelled" },
          });
        }
      }
      rankings.push({
        clubId: club._id,
        clubName: club.clubName || club.name,
        profileImage: club.profileImage,
        managers: managerIds.length,
        tournaments: tournamentCount,
        players,
      });
    }

    rankings.sort((a, b) => {
      if (b.tournaments !== a.tournaments) return b.tournaments - a.tournaments;
      if (b.players !== a.players) return b.players - a.players;
      return b.managers - a.managers;
    });
    rankings.forEach((r, i) => { r.rank = i + 1; });

    res.json({
      success: true,
      window: dateFilter ? { season: season || null, from: from || null, to: to || null } : null,
      total: rankings.length,
      rankings: rankings.slice(0, maxResults),
    });
  } catch (err) {
    console.error("[CLUB_RANKINGS] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
