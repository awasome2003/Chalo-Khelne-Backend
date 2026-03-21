const BookingTopGroup = require('../Modal/BookingGroupTop'); 


exports.createTopPlayerGroup = async (req, res) => {
    try {
      const { tournamentId, groupName, players } = req.body;
  
      // Validate input data
      if (!tournamentId || !groupName || !players || !Array.isArray(players)) {
        return res.status(400).json({
          success: false,
          message: "Invalid input data. Please provide tournamentId, groupName, and players.",
        });
      }
  
      // Check if players array is empty
      if (players.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Players array cannot be empty.",
        });
      }
  
      // Format the players data
      const formattedPlayers = players.map((player) => ({
        playerId: player.playerId,
        playerName: player.playerName,
      }));
  
      // Create a new booking top group
      const newGroup = new BookingTopGroup({
        tournamentId,
        groupName,
        players: formattedPlayers,
      });
  
      // Save the new group to the database
      await newGroup.save();
  
      // Fetch the updated list of existing groups
      const existingGroups = await BookingTopGroup.find({ tournamentId }).populate(
        "players.playerId"
      );
  
      res.status(200).json({
        success: true,
        message: "New group created successfully",
        groups: existingGroups,
      });
    } catch (error) {
      console.error("Error creating group:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to create new group. Please try again later.",
      });
    }
  };
  

  // Fetch all top player groups for a specific tournament
exports.getTopPlayerGroups = async (req, res) => {
    try {
        const { tournamentId } = req.params;

        // Validate tournamentId
        if (!tournamentId) {
            return res.status(400).json({
                success: false,
                message: "Tournament ID is required.",
            });
        }

        // Fetch groups for the given tournament
        const topGroups = await BookingTopGroup.find({ tournamentId }).populate("players.playerId");

        res.status(200).json({
            success: true,
            groups: topGroups,
        });
    } catch (error) {
        console.error("Error fetching top player groups:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch top player groups. Please try again later.",
        });
    }
};
