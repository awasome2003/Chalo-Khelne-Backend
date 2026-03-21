const SuperMatch = require('../Modal/SuperMatch');

// In SuperMatch controller
const createSuperMatch = async (req, res) => {
  try {
    const { tournamentId, groupId, matches } = req.body;

    if (!tournamentId || !groupId || !matches || matches.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data'
      });
    }

    const matchDocuments = matches.map((match, index) => {
      const matchDate = new Date(match.startTime);
      
      return {
        tournamentId,
        groupId,
        title: match.title || `Super Group Match ${index + 1}`,
        type: match.type || 'super_group',
        matchStage: match.matchStage || 'super_group',
        date: matchDate.toISOString().split('T')[0],
        time: matchDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }),
        selectedCourt: `Court ${match.courtNumber}`,
        teams: [
          {
            name: match.player1.userName,
            playerId: match.player1.playerId,
            rank: match.player1.rank,
            groupName: match.player1.groupName,
            score: 0,
            image: null
          },
          {
            name: match.player2.userName,
            playerId: match.player2.playerId,
            rank: match.player2.rank,
            groupName: match.player2.groupName,
            score: 0,
            image: null
          }
        ],
        status: 'scheduled',
        winner: null,
        reminder: {
          isEnabled: true,
          reminderTime: matchDate
        }
      };
    });

    const createdMatches = await SuperMatch.create(matchDocuments);
    console.log('Created matches:', createdMatches);

    res.status(201).json({
      success: true,
      message: 'Super group matches created successfully',
      matches: createdMatches
    });
  } catch (error) {
    console.error('Error creating super group matches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create super group matches',
      error: error.message
    });
  }
};

const getSuperMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        message: 'Tournament ID is required'
      });
    }

    const matches = await SuperMatch.find({
      tournamentId,
    }).sort({ date: 1, time: 1 });

    res.status(200).json({
      success: true,
      matches
    });
  } catch (error) {
    console.error('Error fetching super matches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch super matches',
      error: error.message
    });
  }
};

const updateSuperMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teams, winner, status } = req.body;

    if (!matchId) {
      return res.status(400).json({
        success: false,
        message: 'Match ID is required'
      });
    }

    const match = await SuperMatch.findById(matchId);

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Match not found'
      });
    }

    // Update teams if provided
    if (teams) {
      match.teams = teams;
    }

    // Update winner and status if provided
    if (winner) {
      match.winner = winner;
      match.status = status || 'completed';
    }

    await match.save();

    res.status(200).json({
      success: true,
      message: 'Match updated successfully',
      match
    });
  } catch (error) {
    console.error('Error updating super match:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update match',
      error: error.message
    });
  }
};

// In your updateMatchWinner controller
const updateMatchWinner = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { winner, winnerTeamIndex, status, matchStage } = req.body;

    const match = await SuperMatch.findById(matchId);
    
    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Match not found'
      });
    }

    match.winner = winner;
    match.status = status;
    match.matchStage = matchStage;

    // Update winning team's score
    if (winnerTeamIndex !== undefined && match.teams[winnerTeamIndex]) {
      match.teams[winnerTeamIndex].score = 1;
      match.teams[1 - winnerTeamIndex].score = 0; // Set other team's score to 0
    }

    await match.save();

    res.json({
      success: true,
      message: 'Match winner updated successfully',
      match
    });
  } catch (error) {
    console.error('Error updating match winner:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update match winner'
    });
  }
};


module.exports = {
  createSuperMatch,
  getSuperMatches,
  updateSuperMatch,
  updateMatchWinner
};