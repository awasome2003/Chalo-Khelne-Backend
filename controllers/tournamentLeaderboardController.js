// TOURNAMENT LEADERBOARD CONTROLLER
const Tournament = require('../Modal/Tournament');
const SuperMatch = require('../Modal/SuperMatch');
const DirectKnockoutMatch = require('../Modal/DirectKnockoutMatch');
const TournamentMatch = require('../Modal/Tournnamentmatch');
const TeamKnockoutMatches = require('../Modal/TeamKnockoutMatches');
const TeamKnockoutTeams = require('../Modal/TeamKnockoutTeams');
const Booking = require('../Modal/BookingModel');

// GET ALL TOURNAMENTS WITH LEADERBOARD METADATA
const getAllTournamentsWithLeaderboard = async (req, res) => {
  try {

    // Fetch all tournaments
    const tournaments = await Tournament.find({}).sort({ createdAt: -1 });

    const tournamentsWithMetadata = await Promise.all(
      tournaments.map(async (tournament) => {
        try {
          let metadata = {
            totalParticipants: 0,
            completedMatches: 0,
            totalMatches: 0,
            hasData: false,
            leaderboardType: tournament.type?.toLowerCase().includes('group stage') ? 'players' : 'teams'
          };

          if (tournament.type?.toLowerCase().includes('group stage')) {
            // GROUP STAGE - Count players from bookings AND matches
            const [tournamentMatches, superMatches, directMatches, bookings] = await Promise.all([
              TournamentMatch.find({ tournamentId: tournament._id }),
              SuperMatch.find({ tournamentId: tournament._id }),
              DirectKnockoutMatch.find({ tournamentId: tournament._id }),
              Booking.find({ tournamentId: tournament._id, status: 'confirmed' })
            ]);

            // Count unique players from bookings (most accurate)
            const uniquePlayersFromBookings = new Set();
            bookings.forEach(booking => {
              if (booking.userId) {
                uniquePlayersFromBookings.add(booking.userId.toString());
              }
            });

            // Also count unique players from matches (fallback if no bookings)
            const uniquePlayersFromMatches = new Set();

            // 🚀 ROBUST PLAYER EXTRACTION: Handle multiple data structures
            const extractPlayerId = (player) => {
              if (!player) return null;
              if (player.playerId) return player.playerId.toString();
              if (typeof player === 'object' && player._id) return player._id.toString();
              if (typeof player === 'string') return player;
              return null;
            };

            // From TournamentMatch (League)
            tournamentMatches.forEach(match => {
              const player1Id = extractPlayerId(match.player1);
              const player2Id = extractPlayerId(match.player2);
              if (player1Id) uniquePlayersFromMatches.add(player1Id);
              if (player2Id) uniquePlayersFromMatches.add(player2Id);
            });

            // From SuperMatch (Top Players)
            superMatches.forEach(match => {
              const player1Id = extractPlayerId(match.player1);
              const player2Id = extractPlayerId(match.player2);
              if (player1Id) uniquePlayersFromMatches.add(player1Id);
              if (player2Id) uniquePlayersFromMatches.add(player2Id);
            });

            // From DirectKnockoutMatch (Finals)
            directMatches.forEach(match => {
              const player1Id = extractPlayerId(match.player1);
              const player2Id = extractPlayerId(match.player2);
              if (player1Id) uniquePlayersFromMatches.add(player1Id);
              if (player2Id) uniquePlayersFromMatches.add(player2Id);
            });

            // Use bookings count if available, otherwise use matches count
            metadata.totalParticipants = uniquePlayersFromBookings.size > 0
              ? uniquePlayersFromBookings.size
              : uniquePlayersFromMatches.size;

            metadata.totalMatches = tournamentMatches.length + superMatches.length + directMatches.length;

            // Count completed matches
            metadata.completedMatches =
              tournamentMatches.filter(m => m.status === 'COMPLETED').length +
              superMatches.filter(m => m.status === 'completed' || m.status === 'COMPLETED').length +
              directMatches.filter(m => m.status === 'COMPLETED').length;

            metadata.hasData = metadata.totalMatches > 0;

          } else if (tournament.type?.toLowerCase().includes('knockout')) {
            // KNOCKOUT - Count teams from TeamKnockoutTeams AND bookings
            const [knockoutMatches, knockoutTeams, bookings] = await Promise.all([
              TeamKnockoutMatches.find({ tournamentId: tournament._id }),
              TeamKnockoutTeams.find({ tournamentId: tournament._id }),
              Booking.find({ tournamentId: tournament._id, status: 'confirmed', tournamentType: 'Team Knockouts' })
            ]);

            // Use knockoutTeams count if available, otherwise use bookings count
            metadata.totalParticipants = knockoutTeams.length > 0
              ? knockoutTeams.length
              : bookings.length;

            metadata.totalMatches = knockoutMatches.length;
            metadata.completedMatches = knockoutMatches.filter(m =>
              m.status === 'COMPLETED' || m.winnerId
            ).length;
            metadata.hasData = metadata.totalMatches > 0 || metadata.totalParticipants > 0;
          }

          return {
            _id: tournament._id,
            title: tournament.title,
            tournamentLogo: tournament.tournamentLogo,
            type: tournament.type,
            sportsType: tournament.sportsType,
            eventLocation: tournament.eventLocation,
            startDate: tournament.startDate,
            endDate: tournament.endDate,
            tournamentStatus: tournament.tournamentStatus,
            roundTwoMode: tournament.roundTwoMode,
            currentStage: tournament.currentStage,
            createdAt: tournament.createdAt,
            metadata
          };

        } catch (error) {
          console.error(`Error processing tournament ${tournament._id}:`, error);
          return {
            _id: tournament._id,
            title: tournament.title,
            type: tournament.type,
            metadata: { totalParticipants: 0, hasData: false, leaderboardType: 'unknown' }
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      message: 'Tournaments with leaderboard metadata fetched successfully',
      data: {
        tournaments: tournamentsWithMetadata,
        summary: {
          totalTournaments: tournamentsWithMetadata.length,
          groupStageTournaments: tournamentsWithMetadata.filter(t => t.type?.includes('group stage')).length,
          knockoutTournaments: tournamentsWithMetadata.filter(t => t.type?.includes('knockout')).length,
          tournamentsWithData: tournamentsWithMetadata.filter(t => t.metadata.hasData).length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching tournaments with leaderboard metadata:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tournaments with leaderboard metadata',
      error: error.message
    });
  }
};

// GET GROUP STAGE PLAYERS LEADERBOARD (Complete Player Journey)
const getGroupStagePlayersLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // 1. Fetch Tournament Details
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: 'Tournament not found'
      });
    }

    if (!tournament.type?.toLowerCase().includes('group stage')) {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is for group stage tournaments only'
      });
    }

    // 2. Fetch All Match Data Based on Tournament Mode
    let tournamentMatches = [];
    let superMatches = [];
    let directMatches = [];

    if (tournament.roundTwoMode === 'round2-plus-knockout') {
      // CORRECTED FLOW: TournamentMatch (Round 1 & 2) + SuperMatch (Knockout)
      [tournamentMatches, superMatches] = await Promise.all([
        TournamentMatch.find({ tournamentId }).lean(),
        SuperMatch.find({ tournamentId }).lean()
      ]);
    } else if (tournament.roundTwoMode === 'direct-knockout') {
      // CORRECTED FLOW: TournamentMatch (Round 1) + DirectKnockoutMatch (Final)
      [tournamentMatches, directMatches] = await Promise.all([
        TournamentMatch.find({ tournamentId }).lean(),
        DirectKnockoutMatch.find({ tournamentId }).lean()
      ]);
    } else {
      // Fallback: Fetch all match types for compatibility
      [tournamentMatches, superMatches, directMatches] = await Promise.all([
        TournamentMatch.find({ tournamentId }).lean(),
        SuperMatch.find({ tournamentId }).lean(),
        DirectKnockoutMatch.find({ tournamentId }).lean()
      ]);
    }

    // 🚀 PROGRESSIVE VIEWING: Show data even if tournament is incomplete
    const totalMatches = tournamentMatches.length + superMatches.length + directMatches.length;
    if (totalMatches === 0) {

      // Fetch all registered players from bookings
      const bookings = await Booking.find({
        tournamentId,
        status: 'confirmed'
      }).lean();


      // Extract unique players from bookings
      const uniquePlayers = new Set();
      bookings.forEach(booking => {
        if (booking.userId) {
          uniquePlayers.add(booking.userId.toString());
        }
      });

      // Create player leaderboard entries with zero stats
      const registeredPlayers = Array.from(uniquePlayers).map((playerId, index) => {
        const booking = bookings.find(b => b.userId.toString() === playerId);
        return {
          playerId: playerId,
          playerName: booking?.userName || 'Unknown Player',
          totalMatches: 0,
          totalWins: 0,
          totalLosses: 0,
          totalWinRate: 0,
          groupStageStats: { matches: 0, wins: 0, points: 0 },
          knockoutStats: { matches: 0, wins: 0 },
          leagueStats: { matches: 0, wins: 0 },
          topPlayersStats: { matches: 0, wins: 0 },
          leagueWinRate: 0,
          topPlayersWinRate: 0,
          knockoutWinRate: 0,
          stageReached: 'Registered',
          championships: 0,
          performanceScore: 0
        };
      });

      return res.status(200).json({
        success: true,
        message: `Tournament found with ${registeredPlayers.length} registered players. Matches not started yet.`,
        data: {
          players: registeredPlayers,
          statistics: {
            tournament: {
              _id: tournament._id,
              title: tournament.title,
              type: tournament.type,
              roundTwoMode: tournament.roundTwoMode,
              currentStage: 'Registration Complete'
            },
            totalPlayers: registeredPlayers.length,
            totalMatches: 0,
            completedMatches: 0,
            currentStage: 'Registered - Matches Not Started',
            progressMessage: `${registeredPlayers.length} players registered. Tournament will begin soon!`
          },
          lastUpdated: new Date().toISOString()
        }
      });
    }

    // 3. Detect Current Tournament Stage
    const currentStage = detectCurrentTournamentStage(tournament, tournamentMatches, superMatches, directMatches);

    // 4. Pre-populate with all registered players from bookings FIRST
    const bookings = await Booking.find({
      tournamentId,
      status: 'confirmed'
    }).lean();

    const playerStatsMap = new Map();

    // Add all registered players to the map FIRST
    bookings.forEach(booking => {
      if (booking.userId) {
        const playerId = booking.userId.toString();
        playerStatsMap.set(playerId, {
          playerId: playerId,
          playerName: booking.userName || 'Unknown Player',
          totalMatches: 0,
          totalWins: 0,
          totalLosses: 0,
          totalWinRate: 0,
          groupStageStats: { matches: 0, wins: 0, points: 0 },
          knockoutStats: { matches: 0, wins: 0 },
          leagueStats: { matches: 0, wins: 0 },
          topPlayersStats: { matches: 0, wins: 0 },
          leagueWinRate: 0,
          topPlayersWinRate: 0,
          knockoutWinRate: 0,
          stageReached: 'Registered',
          championships: 0,
          performanceScore: 0
        });
      }
    });

    // 5. Now process matches - name matching will find existing players
    // Process TournamentMatch (Group Stage Rounds 1 & 2)
    tournamentMatches.forEach(match => {
      processPlayerForGroupStage(match.player1, match, 'TournamentMatch', 'player1', playerStatsMap, tournament);
      processPlayerForGroupStage(match.player2, match, 'TournamentMatch', 'player2', playerStatsMap, tournament);
    });

    // Process based on tournament mode
    if (tournament.roundTwoMode === 'round2-plus-knockout') {
      // SuperMatch for knockout phase
      superMatches.forEach(match => {
        processPlayerForGroupStage(match.player1, match, 'SuperMatch', 'player1', playerStatsMap, tournament);
        processPlayerForGroupStage(match.player2, match, 'SuperMatch', 'player2', playerStatsMap, tournament);
      });
    } else if (tournament.roundTwoMode === 'direct-knockout') {
      // DirectKnockoutMatch for final elimination
      directMatches.forEach(match => {
        processPlayerForGroupStage(match.player1, match, 'DirectKnockoutMatch', 'player1', playerStatsMap, tournament);
        processPlayerForGroupStage(match.player2, match, 'DirectKnockoutMatch', 'player2', playerStatsMap, tournament);
      });
    }

    // 5. Convert to Array and Calculate Final Stats
    const playersLeaderboard = Array.from(playerStatsMap.values())
      .map(player => ({
        ...player,
        totalWinRate: player.totalMatches > 0 ? Math.round((player.totalWins / player.totalMatches) * 100) : 0,
        leagueWinRate: player.leagueStats.matches > 0 ? Math.round((player.leagueStats.wins / player.leagueStats.matches) * 100) : 0,
        topPlayersWinRate: player.topPlayersStats.matches > 0 ? Math.round((player.topPlayersStats.wins / player.topPlayersStats.matches) * 100) : 0,
        knockoutWinRate: player.knockoutStats.matches > 0 ? Math.round((player.knockoutStats.wins / player.knockoutStats.matches) * 100) : 0,
        performanceScore: calculatePlayerPerformanceScore(player)
      }))
      .sort((a, b) => {
        // Sort by: Championships > Performance Score > Win Rate > Total Wins
        if (b.championships !== a.championships) return b.championships - a.championships;
        if (b.performanceScore !== a.performanceScore) return b.performanceScore - a.performanceScore;
        if (b.totalWinRate !== a.totalWinRate) return b.totalWinRate - a.totalWinRate;
        return b.totalWins - a.totalWins;
      });

    // 5. Enhanced Tournament Statistics with Progressive Data
    const completedTournamentMatches = tournamentMatches.filter(m => m.status === 'COMPLETED').length;
    const completedSuperMatches = superMatches.filter(m => m.status === 'completed' || m.status === 'COMPLETED').length;
    const completedDirectMatches = directMatches.filter(m => m.status === 'COMPLETED').length;
    const totalCompletedMatches = completedTournamentMatches + completedSuperMatches + completedDirectMatches;

    const statistics = {
      tournament: {
        _id: tournament._id,
        title: tournament.title,
        type: tournament.type,
        roundTwoMode: tournament.roundTwoMode,
        currentStage: currentStage
      },
      totalPlayers: playersLeaderboard.length,
      totalMatches: totalMatches,
      completedMatches: totalCompletedMatches,
      champions: playersLeaderboard.filter(p => p.championships > 0),

      // 🚀 PROGRESSIVE VIEWING: Stage-specific breakdown
      currentStage: currentStage,
      progressPercentage: totalMatches > 0 ? Math.round((totalCompletedMatches / totalMatches) * 100) : 0,
      progressMessage: generateProgressMessage(tournament, currentStage, totalCompletedMatches, totalMatches),

      // Stage breakdown based on tournament mode
      stageBreakdown: tournament.roundTwoMode === 'round2-plus-knockout' ? {
        groupStage: {
          total: tournamentMatches.length,
          completed: completedTournamentMatches,
          description: 'Round 1 & 2 Group Matches'
        },
        knockout: {
          total: superMatches.length,
          completed: completedSuperMatches,
          description: 'Knockout Phase (SuperMatch)'
        }
      } : tournament.roundTwoMode === 'direct-knockout' ? {
        round1: {
          total: tournamentMatches.length,
          completed: completedTournamentMatches,
          description: 'Round 1 Matches'
        },
        finalKnockout: {
          total: directMatches.length,
          completed: completedDirectMatches,
          description: 'Final Knockout Phase'
        }
      } : {
        // Legacy fallback
        league: { total: tournamentMatches.length, completed: completedTournamentMatches },
        topPlayers: { total: superMatches.length, completed: completedSuperMatches },
        knockout: { total: directMatches.length, completed: completedDirectMatches }
      }
    };


    res.status(200).json({
      success: true,
      message: 'Group stage players leaderboard fetched successfully',
      data: {
        players: playersLeaderboard,
        statistics,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching group stage players leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group stage players leaderboard',
      error: error.message
    });
  }
};

// GET KNOCKOUT TEAMS LEADERBOARD
const getKnockoutTeamsLeaderboard = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // 1. Fetch Tournament Details
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: 'Tournament not found'
      });
    }

    if (!tournament.type?.includes('knockout')) {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is for knockout tournaments only'
      });
    }

    // 2. Fetch Team and Match Data
    const [knockoutTeams, knockoutMatches] = await Promise.all([
      TeamKnockoutTeams.find({ tournamentId }).lean(),
      TeamKnockoutMatches.find({ tournamentId }).lean()
    ]);

    // 3. Process Teams Leaderboard
    const teamsLeaderboard = knockoutTeams.map(team => {
      // Find team's matches using correct TeamKnockoutMatches field names
      const teamMatches = knockoutMatches.filter(match =>
        (match.team1Id && match.team1Id.toString() === team._id.toString()) ||
        (match.team2Id && match.team2Id.toString() === team._id.toString())
      );

      const wins = teamMatches.filter(match =>
        match.winnerId && match.winnerId.toString() === team._id.toString()
      ).length;

      const losses = teamMatches.filter(match =>
        match.winnerId &&
        match.winnerId.toString() !== team._id.toString() &&
        match.status === 'COMPLETED'
      ).length;

      return {
        _id: team._id,
        teamName: team.teamName,
        captain: team.playerPositions.A,
        players: [
          team.playerPositions.A,
          team.playerPositions.B,
          team.playerPositions.C
        ],
        substitutes: team.substitutes,
        status: team.status,
        currentRound: team.currentRound,
        matchesPlayed: teamMatches.length,
        matchesWon: wins,
        matchesLost: losses,
        winRate: teamMatches.length > 0 ? Math.round((wins / teamMatches.length) * 100) : 0,
        setsWon: team.setsWon,
        setsLost: team.setsLost,
        isEliminated: team.status === 'ELIMINATED',
        isChampion: team.status === 'ACTIVE' && wins > 0 && losses === 0 && teamMatches.length > 1,
        lastMatchRound: Math.max(...teamMatches.map(m => m.round || 1), 0)
      };
    })
      .sort((a, b) => {
        // Sort by: Status (Active first) > Current Round > Win Rate > Matches Won
        if (a.status !== b.status) {
          if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
          if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
        }
        if (b.currentRound !== a.currentRound) return b.currentRound - a.currentRound;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.matchesWon - a.matchesWon;
      });

    // 4. Tournament Statistics
    const completedMatchesCount = knockoutMatches.filter(m => m.winnerId || m.status === 'COMPLETED').length;
    const activeTeamsCount = teamsLeaderboard.filter(t => t.status === 'ACTIVE').length;
    const eliminatedTeamsCount = teamsLeaderboard.filter(t => t.status === 'ELIMINATED').length;
    const championsCount = teamsLeaderboard.filter(t => t.isChampion).length;

    // 🎯 Calculate expected total matches for knockout (n-1 where n = total teams)
    // Example: 4 teams = 3 matches (2 semis + 1 final), 8 teams = 7 matches, etc.
    const totalTeamsCount = knockoutTeams.length;
    const expectedTotalMatches = totalTeamsCount > 0 ? totalTeamsCount - 1 : 0;

    // Use the higher of actual matches or expected matches
    // This handles cases where matches haven't been created yet
    const totalMatchesCount = Math.max(knockoutMatches.length, expectedTotalMatches);

    // Determine current stage based on teams status
    let currentStage = 'In Progress';
    if (championsCount > 0) {
      currentStage = 'Tournament Complete';
    } else if (activeTeamsCount === 2 && eliminatedTeamsCount > 0) {
      currentStage = 'Final Round';
    } else if (activeTeamsCount <= 4 && eliminatedTeamsCount > 0) {
      currentStage = 'Semi-Finals';
    } else if (eliminatedTeamsCount > 0) {
      currentStage = 'Knockout In Progress';
    } else {
      currentStage = 'Tournament Started';
    }

    // Calculate progress percentage
    const progressPercentage = totalMatchesCount > 0
      ? Math.round((completedMatchesCount / totalMatchesCount) * 100)
      : 0;

    // Generate progress message
    let progressMessage = '';
    if (progressPercentage === 0) {
      progressMessage = 'Knockout tournament starting soon';
    } else if (progressPercentage === 100) {
      progressMessage = 'Tournament complete! Champion crowned.';
    } else if (activeTeamsCount === 2) {
      progressMessage = `Final match in progress (${progressPercentage}% complete)`;
    } else if (activeTeamsCount <= 4) {
      progressMessage = `Semi-finals underway (${progressPercentage}% complete)`;
    } else {
      progressMessage = `${completedMatchesCount} of ${totalMatchesCount} matches completed (${progressPercentage}% complete)`;
    }

    const statistics = {
      tournament: {
        _id: tournament._id,
        title: tournament.title,
        type: tournament.type,
        currentStage: tournament.currentStage
      },
      totalTeams: knockoutTeams.length,
      totalMatches: totalMatchesCount,
      completedMatches: completedMatchesCount,
      activeTeams: activeTeamsCount,
      eliminatedTeams: eliminatedTeamsCount,
      champions: teamsLeaderboard.filter(t => t.isChampion),

      // 🎯 Added missing progress fields
      progressPercentage: progressPercentage,
      progressMessage: progressMessage,
      currentStage: currentStage,

      rounds: {
        totalRounds: Math.max(...knockoutMatches.map(m => m.totalRounds || 1), 0),
        currentRound: Math.max(...teamsLeaderboard.map(t => t.currentRound), 1)
      }
    };

    res.status(200).json({
      success: true,
      message: 'Knockout teams leaderboard fetched successfully',
      data: {
        teams: teamsLeaderboard,
        statistics,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching knockout teams leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch knockout teams leaderboard',
      error: error.message
    });
  }
};

// HELPER FUNCTION: Detect Current Tournament Stage
const detectCurrentTournamentStage = (tournament, tournamentMatches, superMatches, directMatches) => {
  if (tournament.roundTwoMode === 'round2-plus-knockout') {
    // Check if knockout phase has started
    if (superMatches.length > 0) {
      const completedSuperMatches = superMatches.filter(m => m.status === 'completed' || m.status === 'COMPLETED');
      if (completedSuperMatches.length === superMatches.length && superMatches.length > 0) {
        return 'Knockout Phase Complete';
      }
      return 'Knockout Phase';
    }

    // Check group stage progress
    const completedGroupMatches = tournamentMatches.filter(m => m.status === 'COMPLETED');
    if (completedGroupMatches.length === tournamentMatches.length && tournamentMatches.length > 0) {
      return 'Group Stage Complete - Awaiting Knockout';
    } else if (tournamentMatches.length > 0) {
      return 'Group Stage In Progress';
    }

    return 'Tournament Setup';

  } else if (tournament.roundTwoMode === 'direct-knockout') {
    // Check if final knockout has started
    if (directMatches.length > 0) {
      const completedDirectMatches = directMatches.filter(m => m.status === 'COMPLETED');
      if (completedDirectMatches.length === directMatches.length && directMatches.length > 0) {
        return 'Final Knockout Complete';
      }
      return 'Final Knockout';
    }

    // Check round 1 progress
    const completedRound1Matches = tournamentMatches.filter(m => m.status === 'COMPLETED');
    if (completedRound1Matches.length === tournamentMatches.length && tournamentMatches.length > 0) {
      return 'Round 1 Complete - Awaiting Final';
    } else if (tournamentMatches.length > 0) {
      return 'Round 1 In Progress';
    }

    return 'Tournament Setup';
  }

  // Legacy fallback
  return 'Tournament In Progress';
};

// HELPER FUNCTION: Generate Progress Message
const generateProgressMessage = (tournament, currentStage, completedMatches, totalMatches) => {
  const progressPercent = totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0;

  if (progressPercent === 0) {
    return 'Tournament starting soon. Stay tuned for live updates!';
  } else if (progressPercent === 100) {
    return 'Tournament complete! Final rankings available.';
  } else if (tournament.roundTwoMode === 'round2-plus-knockout') {
    if (currentStage.includes('Group Stage')) {
      return `Group stage matches in progress (${progressPercent}% complete)`;
    } else if (currentStage.includes('Knockout')) {
      return `Knockout phase underway (${progressPercent}% complete)`;
    }
  } else if (tournament.roundTwoMode === 'direct-knockout') {
    if (currentStage.includes('Round 1')) {
      return `Round 1 matches in progress (${progressPercent}% complete)`;
    } else if (currentStage.includes('Final')) {
      return `Final knockout phase underway (${progressPercent}% complete)`;
    }
  }

  return `Tournament in progress (${progressPercent}% complete)`;
};

// ENHANCED HELPER FUNCTION: Process Player for Group Stage
const processPlayerForGroupStage = (player, match, matchType, playerRole, statsMap, tournament) => {
  // 🚀 ROBUST PLAYER DATA HANDLING: Support multiple data structures
  if (!player) return;

  let playerId, playerName;

  // Extract playerName first
  if (player.playerId || player._id) {
    // Structure: {playerId: ObjectId, userName: 'Name'} or {_id: ObjectId, playerName: 'Name'}
    playerId = (player.playerId || player._id).toString();
    playerName = (player.playerName || player.userName || 'Unknown Player').trim();
  } else if (typeof player === 'string') {
    // Structure: String ObjectId
    playerId = player;
    playerName = 'Unknown Player'; // Will be resolved later
  } else if (typeof player === 'object' && (player.playerName || player.userName)) {
    // Structure: {playerId: null, playerName: 'Name'}
    playerId = null;
    playerName = (player.playerName || player.userName).trim();
  } else {
    // Unknown structure - skip
    console.warn(`⚠️ Unknown player data structure in ${matchType}:`, player);
    return;
  }

  // 🎯 CRITICAL FIX: Always try to normalize playerId by matching with booking data
  // This handles cases where Round 2 matches have different playerIds than Round 1
  if (playerName && playerName !== 'Unknown Player') {
    const normalizedSearchName = playerName.toLowerCase().replace(/\s+/g, ' ').trim();

    let existingPlayerEntry = null;
    for (let [existingId, existingStats] of statsMap.entries()) {
      const normalizedExistingName = existingStats.playerName.toLowerCase().replace(/\s+/g, ' ').trim();
      if (normalizedExistingName === normalizedSearchName) {
        existingPlayerEntry = { id: existingId, stats: existingStats };
        break;
      }
    }

    if (existingPlayerEntry) {
      // Always use the booking's player ID (first occurrence)
      if (playerId && playerId !== existingPlayerEntry.id) {
      }
      playerId = existingPlayerEntry.id;
    } else if (!playerId || playerId === 'Unknown Player') {
      // No existing player found and no valid ID - create temporary
      playerId = `temp_${playerName.toLowerCase().replace(/\s+/g, '_')}`;
      console.warn(`⚠️ WARNING: Player "${playerName}" not found in bookings! Creating temporary ID: ${playerId}`);
    }
    // else: playerId exists but no booking match - use the provided playerId
  }

  if (!playerId) {
    console.warn(`⚠️ Could not extract playerId from player data:`, player);
    return;
  }

  if (!statsMap.has(playerId)) {
    statsMap.set(playerId, {
      playerId: playerId,
      playerName: playerName,
      totalMatches: 0,
      totalWins: 0,
      totalLosses: 0,
      championships: 0,
      stageReached: 'Group Stage',
      // Enhanced stats for different tournament modes
      groupStageStats: { matches: 0, wins: 0, points: 0 },
      knockoutStats: { matches: 0, wins: 0 },
      // Legacy compatibility
      leagueStats: { matches: 0, wins: 0 },
      topPlayersStats: { matches: 0, wins: 0 }
    });
  }

  const playerStats = statsMap.get(playerId);
  playerStats.totalMatches++;

  // 🎯 STAGE PROGRESSION HIERARCHY (never go backwards)
  const stageHierarchy = {
    'Registered': 0,
    'Group Stage': 1,
    'Round 1': 1,
    'Top Players': 2,
    'Round 2': 2,
    'Super Players': 3,
    'Knockout Phase': 4,
    'Final Knockout': 4,
    'Champion': 5
  };

  const updateStageIfHigher = (newStage) => {
    const currentLevel = stageHierarchy[playerStats.stageReached] || 0;
    const newLevel = stageHierarchy[newStage] || 0;
    if (newLevel > currentLevel) {
      playerStats.stageReached = newStage;
    }
  };

  // Update stage-specific stats based on match type and tournament mode
  if (matchType === 'TournamentMatch') {
    // Group stage or Round 1 matches
    playerStats.groupStageStats.matches++;
    playerStats.leagueStats.matches++; // Legacy compatibility

    // 🚀 ROBUST WINNER DETECTION: Handle multiple winner structures
    const isWinner = checkIfPlayerWonMatch(match, playerId, playerName);

    if (match.status === 'COMPLETED' && isWinner) {
      playerStats.totalWins++;
      playerStats.groupStageStats.wins++;
      playerStats.groupStageStats.points += 3; // Win = 3 points
      playerStats.leagueStats.wins++; // Legacy compatibility
    } else if (match.status === 'COMPLETED') {
      playerStats.totalLosses++;
      // Loss = 0 points (no change needed)
    }

    // Update stage reached based on tournament mode (only if higher)
    if (tournament.roundTwoMode === 'round2-plus-knockout') {
      updateStageIfHigher('Group Stage');
    } else if (tournament.roundTwoMode === 'direct-knockout') {
      updateStageIfHigher('Round 1');
    }

  } else if (matchType === 'SuperMatch') {
    // Knockout phase for round2-plus-knockout
    playerStats.knockoutStats.matches++;
    playerStats.topPlayersStats.matches++; // Legacy compatibility

    // 🎯 SIMPLE WINNER DETECTION: Just check match.winner.playerName for SuperMatch
    const isWinnerSuper = match.winner &&
      match.winner.playerName &&
      match.winner.playerName.toLowerCase().trim() === playerName.toLowerCase().trim();

    if ((match.status === 'completed' || match.status === 'COMPLETED') && isWinnerSuper) {
      playerStats.totalWins++;
      playerStats.knockoutStats.wins++;
      playerStats.topPlayersStats.wins++; // Legacy compatibility

      // Check if this is a championship match
      if (match.round === 'final') {
        playerStats.championships++;
        updateStageIfHigher('Champion');
      } else {
        updateStageIfHigher('Knockout Phase');
      }
    } else if (match.status === 'completed' || match.status === 'COMPLETED') {
      playerStats.totalLosses++;
    }

    // 🎯 Mark as Super Player if participating in SuperMatch
    if (playerStats.stageReached !== 'Champion') {
      updateStageIfHigher('Super Players');
    }

  } else if (matchType === 'DirectKnockoutMatch') {
    // Final knockout for direct-knockout mode
    playerStats.knockoutStats.matches++;

    // 🎯 SIMPLE WINNER DETECTION: Just check match.result.winner.playerName for DirectKnockoutMatch
    const isWinnerDirect = match.result &&
      match.result.winner &&
      match.result.winner.playerName &&
      match.result.winner.playerName.toLowerCase().trim() === playerName.toLowerCase().trim();

    if (match.status === 'COMPLETED' && isWinnerDirect) {
      playerStats.totalWins++;
      playerStats.knockoutStats.wins++;

      // Check if this is a championship match
      if (match.round === 'final') {
        playerStats.championships++;
        updateStageIfHigher('Champion');
      } else {
        updateStageIfHigher('Final Knockout');
      }
    } else if (match.status === 'COMPLETED') {
      playerStats.totalLosses++;
    }

    // 🎯 Mark as Super Player if participating in DirectKnockoutMatch
    if (playerStats.stageReached !== 'Champion') {
      updateStageIfHigher('Super Players');
    }
  }
};

// ROBUST HELPER FUNCTION: Check if player won match (multiple winner structures)
const checkIfPlayerWonMatch = (match, playerId, playerName) => {
  if (!match) return false;

  // Method 1: Check match.winner field (SuperMatch style)
  if (match.winner) {
    // Case 1a: winner.playerId match
    if (match.winner.playerId && match.winner.playerId.toString() === playerId) {
      return true;
    }
    // Case 1b: winner.playerName match
    if (match.winner.playerName && match.winner.playerName === playerName) {
      return true;
    }
    // Case 1c: winner is just a string ID
    if (typeof match.winner === 'string' && match.winner === playerId) {
      return true;
    }
  }

  // Method 2: Check match.result.winner field (TournamentMatch style)
  if (match.result?.winner) {
    // Case 2a: result.winner.playerId match
    if (match.result.winner.playerId && match.result.winner.playerId.toString() === playerId) {
      return true;
    }
    // Case 2b: result.winner.playerName match
    if (match.result.winner.playerName && match.result.winner.playerName === playerName) {
      return true;
    }
    // Case 2c: result.winner is just a string ID
    if (typeof match.result.winner === 'string' && match.result.winner === playerId) {
      return true;
    }
  }

  // Method 3: Check direct playerId match with winner field
  if (match.winnerId && match.winnerId.toString() === playerId) {
    return true;
  }

  // Method 4: Check if match has scores and determine winner
  if (match.result?.scores && Array.isArray(match.result.scores)) {
    // Find the score for this player and check if they won
    const playerScore = match.result.scores.find(score =>
      score.playerId?.toString() === playerId ||
      score.playerName === playerName
    );

    if (playerScore && playerScore.won === true) {
      return true;
    }

    // Alternative: Check highest score
    const maxScore = Math.max(...match.result.scores.map(s => s.totalScore || s.score || 0));
    if (playerScore && (playerScore.totalScore === maxScore || playerScore.score === maxScore)) {
      return true;
    }
  }

  // Method 5: Fallback - check if this player appears in any winner-related field
  const matchString = JSON.stringify(match).toLowerCase();
  const playerNameLower = playerName.toLowerCase();

  // Look for patterns like "winner": "PlayerName" in the match data
  if (matchString.includes(`"winner"`) && matchString.includes(playerNameLower)) {
    return true;
  }

  return false;
};

// HELPER FUNCTION: Calculate Player Performance Score
const calculatePlayerPerformanceScore = (player) => {
  const baseScore = (player.totalWins * 10) + (player.championships * 100) + (player.totalMatches * 2);
  const stageBonus = {
    'League': 0,
    'Top Players': 50,
    'Knockout': 100,
    'Champion': 200
  }[player.stageReached] || 0;

  const winRateBonus = player.totalMatches > 0 ? (player.totalWins / player.totalMatches) * 30 : 0;

  return Math.round(baseScore + stageBonus + winRateBonus);
};

module.exports = {
  getAllTournamentsWithLeaderboard,
  getGroupStagePlayersLeaderboard,
  getKnockoutTeamsLeaderboard
};