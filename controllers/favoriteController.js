const Turf = require("../Modal/Turf");
const Favorite = require("../Modal/Favorite");

const favoriteController = {
  // Get all favorites for the logged-in user
  getUserFavorites: async (req, res) => {
    try {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      // Find the favorite document for this specific user
      const userFavorite = await Favorite.findOne({ user: userId });

      // If no favorites found or empty turfs array, return empty array
      if (
        !userFavorite ||
        !userFavorite.turfs ||
        userFavorite.turfs.length === 0
      ) {
        return res.json([]);
      }

      // Fetch the turf details for all the favorite turf IDs
      const turfDetails = await Turf.find({
        _id: { $in: userFavorite.turfs },
      });

      // Map the turf details to the format expected by the frontend
      const formattedFavorites = turfDetails.map((turf) => {
        return {
          turfId: turf._id,
          name: turf.name,
          image: turf.images && turf.images.length > 0 ? turf.images[0] : null,
          address: turf.address,
          sports: turf.sports,
          rating: turf.ratings?.average || 0,
          distance: turf.distance || "NA",
        };
      });

      res.json(formattedFavorites);
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({
        message: "Failed to fetch favorites",
        error: error.message,
      });
    }
  },

  // Check if a turf is a favorite for the user
  checkFavorite: async (req, res) => {
    try {
      const { userId, turfId } = req.query;

      if (!userId || !turfId) {
        return res.status(400).json({
          message: "User ID and Turf ID are required",
        });
      }

      const favorite = await Favorite.findOne({
        user: userId,
        turfs: turfId,
      });

      res.json({ isFavorite: !!favorite });
    } catch (error) {
      console.error("Error checking favorite status:", error);
      res.status(500).json({
        message: "Failed to check favorite status",
        error: error.message,
      });
    }
  },

  // Toggle favorite status (add or remove)
  toggleFavorite: async (req, res) => {
    try {
      const { userId, turfId, action } = req.body;

      if (!userId || !turfId || !action) {
        return res.status(400).json({
          message: "User ID, Turf ID, and action are required",
        });
      }

      // Check if turf exists
      const turfExists = await Turf.exists({ _id: turfId });
      if (!turfExists) {
        return res.status(404).json({ message: "Turf not found" });
      }

      // Find or create the user's favorites document
      let userFavorite = await Favorite.findOne({ user: userId });

      if (!userFavorite) {
        // Create a new favorites document for this user
        userFavorite = new Favorite({
          user: userId,
          turfs: [],
        });
      }

      if (action === "add") {
        // Check if turfId is not already in the array
        if (!userFavorite.turfs.includes(turfId)) {
          userFavorite.turfs.push(turfId);
          await userFavorite.save();
          res.json({ message: "Added to favorites" });
        } else {
          res.json({ message: "Already in favorites" });
        }
      } else if (action === "remove") {
        // Remove turfId from the array
        userFavorite.turfs = userFavorite.turfs.filter(
          (id) => id.toString() !== turfId.toString()
        );
        await userFavorite.save();
        res.json({ message: "Removed from favorites" });
      } else {
        res
          .status(400)
          .json({ message: "Invalid action. Use 'add' or 'remove'" });
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      res.status(500).json({
        message: "Failed to update favorite status",
        error: error.message,
      });
    }
  },
};

module.exports = favoriteController;
