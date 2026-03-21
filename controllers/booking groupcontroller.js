const BookingGroup = require("../Modal/bookinggroup");
const Tournament = require("../Modal/Tournament");
const Booking = require("../Modal/BookingModel");

exports.createBookingGroup = async (req, res) => {
  try {
    const { tournamentId, groupName, players, category } = req.body;

    // 1. Validate input
    if (!tournamentId || !groupName || !players || players.length === 0 || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: tournamentId, groupName, category, or players",
      });
    }

    // 2. Check if tournament exists
    const tournamentExists = await Tournament.findById(tournamentId);
    if (!tournamentExists) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found",
      });
    }

    // 3. Validate players exist (from Booking)
    const playerDocs = [];
    for (let playerId of players) {
      const booking = await Booking.findById(playerId).populate("userId");
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: `Booking with ID ${playerId} not found`,
        });
      }

      // push user info into group players
      playerDocs.push({
        playerId: booking.userId._id,
        userName: booking.userId.name,
        bookingDate: booking.bookingDate || null,
      });
    }

    // 4. Create and save new booking group
    const newGroup = new BookingGroup({
      tournamentId,
      groupName,
      category,
      players: playerDocs,
    });

    await newGroup.save();

    return res.status(201).json({
      success: true,
      message: "Booking group created successfully",
      data: newGroup,
    });

  } catch (err) {
    console.error("Error creating booking group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.getBookingGroups = async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const groups = await BookingGroup.find({ tournamentId })
      .populate("tournamentId", "title type")
      .populate({
        path: "players",
        populate: {
          path: "userId",
          select: "name profileImage",
        },
      });

    return res.status(200).json({
      success: true,
      data: groups,
    });
  } catch (err) {
    console.error("Error fetching booking groups:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.updateBookingGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { groupName, players, category } = req.body;

    /* 1. Find group */
    const bookingGroup = await BookingGroup.findById(groupId);

    if (!bookingGroup) {
      return res.status(404).json({
        success: false,
        message: "Booking group not found"
      });
    }

    const tournamentId = bookingGroup.tournamentId;

    /* 2. Category validation */
    if (!category && !bookingGroup.category) {
      return res.status(400).json({
        success: false,
        message: "Category is required"
      });
    }

    /* 3. Players update (IMPORTANT FIX) */
    if (Array.isArray(players)) {
      const embeddedPlayers = [];

      for (const userId of players) {
        const booking = await Booking.findOne({
          userId,
          tournamentId
        }).populate("userId", "name");

        if (!booking) {
          return res.status(404).json({
            success: false,
            message: `Player with ID ${userId} not found in bookings for this tournament`
          });
        }

        embeddedPlayers.push({
          playerId: booking.userId._id,
          userName: booking.userId.name,
          bookingDate: booking.createdAt,
          joinedAt: new Date()
        });
      }

      bookingGroup.players = embeddedPlayers;
    }

    /* 4. Other updates */
    if (groupName) bookingGroup.groupName = groupName;
    if (category) bookingGroup.category = category;

    /* 5. Save */
    await bookingGroup.save();

    return res.status(200).json({
      success: true,
      message: "Booking group updated successfully",
      data: bookingGroup
    });

  } catch (error) {
    console.error("Error updating booking group:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error"
    });
  }
};

exports.deleteBookingGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const bookingGroup = await BookingGroup.findByIdAndDelete(groupId);
    if (!bookingGroup) {
      return res.status(404).json({
        success: false,
        message: "Booking group not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Booking group deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting booking group:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// 🚀 Get group-specific match format
exports.getGroupMatchFormat = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await BookingGroup.findById(groupId).select("matchFormat");

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(200).json({
      success: true,
      matchFormat: group.matchFormat,
    });
  } catch (err) {
    console.error("Error fetching group match format:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// 🚀 Update group-specific match format
exports.updateGroupMatchFormat = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { matchFormat } = req.body;

    if (!matchFormat) {
      return res.status(400).json({
        success: false,
        message: "Match format data is required",
      });
    }

    const group = await BookingGroup.findByIdAndUpdate(
      groupId,
      { matchFormat },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Group match format updated successfully",
      data: group.matchFormat,
    });
  } catch (err) {
    console.error("Error updating group match format:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

