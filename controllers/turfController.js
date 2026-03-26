const Turf = require("../Modal/Turf");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const { cleanupFile, turfsDir } = require("../middleware/uploads");
const path = require("path");

// Controller methods for turf management
const turfController = {
  createTurf: async (req, res) => {
    try {
      const ownerId = req.body.ownerId;

      if (!ownerId) {
        if (req.files) {
          for (const file of req.files) {
            await cleanupFile(file.path);
          }
        }
        return res.status(400).json({ message: "Owner ID is required" });
      }

      // Check both User and Manager models
      let owner = await User.findById(ownerId);
      if (!owner) owner = await Manager.findById(ownerId);
      if (!owner) {
        if (req.files) {
          for (const file of req.files) {
            await cleanupFile(file.path);
          }
        }
        return res.status(400).json({ message: "Owner not found" });
      }

      const clubName = owner.role === "ClubAdmin" ? owner.clubName : null;

      const imagePaths = req.files && req.files.length > 0
        ? req.files.map((file) =>
          path.join("turfs", path.basename(file.path)).replace(/\\/g, "/")
        )
        : [];


      // Parse sports if stringified (from form-data)
      let sports = [];
      if (req.body.sports) {
        sports = typeof req.body.sports === "string"
          ? JSON.parse(req.body.sports)
          : req.body.sports;
      }

      // ✅ Simplified facilities: string array
      let facilities = [];
      if (req.body.facilities) {
        facilities = typeof req.body.facilities === "string"
          ? JSON.parse(req.body.facilities)
          : req.body.facilities;
      }

      // ✅ Simplified available time slots
      let availableTimeSlots = [];
      if (req.body.availableTimeSlots) {
        availableTimeSlots = typeof req.body.availableTimeSlots === "string"
          ? JSON.parse(req.body.availableTimeSlots)
          : req.body.availableTimeSlots;
      }

      // Build address object matching Turf schema
      const address = {
        fullAddress: req.body.address || "",
        area: req.body.area || "",
        city: req.body.city || "",
        pincode: req.body.pincode || "",
        coordinates: {
          lat: parseFloat(req.body.latitude) || 0,
          lng: parseFloat(req.body.longitude) || 0,
        },
      };

      const newTurf = new Turf({
        name: req.body.name,
        owner: ownerId,
        clubName,
        images: imagePaths,
        address,
        sports,
        facilities,
        availableTimeSlots,
        description: req.body.description,
        isActive: true,
      });

      await newTurf.save();

      res.status(201).json({
        message: "Turf created successfully",
        turf: newTurf,
      });
    } catch (error) {
      console.error("Error creating turf:", error);

      if (req.files) {
        for (const file of req.files) {
          await cleanupFile(file.path);
        }
      }

      res.status(500).json({
        message: "Failed to create turf",
        error: error.message,
      });
    }
  },

  // Get all turfs with filtering options
  getAllTurfs: async (req, res) => {
    try {
      const {
        city,
        area,
        pincode,
        sport,
        isActive,
        isApproved,
        ownerId,
        limit = 10,
        page = 1,
      } = req.query;

      // Build query object
      const query = {};

      if (city) query["address.city"] = { $regex: new RegExp(city, "i") };
      if (area) query["address.area"] = { $regex: new RegExp(area, "i") };
      if (pincode) query["address.pincode"] = pincode;
      if (sport) query["sports.name"] = { $regex: new RegExp(sport, "i") };
      if (isActive !== undefined) query.isActive = isActive === "true";
      if (isApproved !== undefined) query.isApproved = isApproved === "true";
      if (ownerId) query.owner = ownerId;

      // Default to only showing active turfs for public queries
      if (!req.query.isActive) {
        query.isActive = true;
      }

      // Only apply isApproved filter if it exists in the schema
      // This prevents filtering by a non-existent field
      if (isApproved !== undefined) {
        query.isApproved = isApproved === "true";
      }

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute query with pagination
      const turfs = await Turf.find(query)
        .populate("owner", "name email mobile")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Get total count for pagination
      const total = await Turf.countDocuments(query);

      res.json({
        turfs,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching turfs:", error);
      res.status(500).json({
        message: "Failed to fetch turfs",
        error: error.message,
      });
    }
  },

  // Get a single turf by ID
  getTurfById: async (req, res) => {
    try {
      const turf = await Turf.findById(req.params.id)
        .populate("owner", "name email mobile")
        .populate("assignedManagers", "name email isActive")
        .populate("reviews.user", "name profileImage");

      if (!turf) {
        return res.status(404).json({ message: "Turf not found" });
      }

      res.json(turf);
    } catch (error) {
      console.error("Error fetching turf:", error);
      res.status(500).json({
        message: "Failed to fetch turf details",
        error: error.message,
      });
    }
  },

  // Update a turf
  updateTurf: async (req, res) => {
    try {
      // Get owner ID from request body
      const ownerId = req.body.ownerId;

      if (!ownerId) {
        // Clean up any uploaded files
        if (req.files) {
          for (const file of req.files) {
            await cleanupFile(file.path);
          }
        }
        return res.status(400).json({ message: "Owner ID is required" });
      }

      const turf = await Turf.findById(req.params.id);

      if (!turf) {
        // Clean up any uploaded files
        if (req.files) {
          for (const file of req.files) {
            await cleanupFile(file.path);
          }
        }
        return res.status(404).json({ message: "Turf not found" });
      }

      // Check permissions - only owner can update
      if (turf.owner.toString() !== ownerId) {
        // Clean up any uploaded files
        if (req.files) {
          for (const file of req.files) {
            await cleanupFile(file.path);
          }
        }
        return res
          .status(403)
          .json({ message: "Unauthorized: Insufficient permissions" });
      }

      // Handle new images
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const relativePath = path
            .join("turfs", path.basename(file.path))
            .replace(/\\/g, "/");
          turf.images.push({
            path: relativePath,
            name: file.originalname,
            type: file.mimetype,
            uploadedAt: new Date(),
          });
        }
      }

      // Handle deleted images
      if (req.body.deleteImages) {
        const deleteImages = Array.isArray(req.body.deleteImages)
          ? req.body.deleteImages
          : [req.body.deleteImages];

        for (const imagePath of deleteImages) {
          // Find the image in turf.images array
          const imageIndex = turf.images.findIndex(
            (img) => img.path === imagePath
          );

          if (imageIndex !== -1) {
            // Remove from array
            const fullPath = path.join(turfsDir, path.basename(imagePath));
            await cleanupFile(fullPath);
            turf.images.splice(imageIndex, 1);
          }
        }
      }

      // Update basic fields
      if (req.body.name) turf.name = req.body.name;
      if (req.body.description) turf.description = req.body.description;
      if (req.body.razorpayAccountId)
        turf.razorpayAccountId = req.body.razorpayAccountId;

      // Update address
      if (req.body.fullAddress) turf.address.fullAddress = req.body.fullAddress;
      if (req.body.area) turf.address.area = req.body.area;
      if (req.body.city) turf.address.city = req.body.city;
      if (req.body.pincode) turf.address.pincode = req.body.pincode;

      // Update sports if provided
      if (req.body.sports) {
        let sports = [];
        if (typeof req.body.sports === "string") {
          sports = JSON.parse(req.body.sports);
        } else {
          sports = req.body.sports;
        }
        turf.sports = sports;
      }

      // Update facilities
      if (req.body.artificialTurf !== undefined)
        turf.facilities.artificialTurf =
          req.body.artificialTurf === "true" ||
          req.body.artificialTurf === true;
      if (req.body.multipleFields !== undefined)
        turf.facilities.multipleFields =
          req.body.multipleFields === "true" ||
          req.body.multipleFields === true;
      if (req.body.floodLights !== undefined)
        turf.facilities.floodLights =
          req.body.floodLights === "true" || req.body.floodLights === true;
      if (req.body.ledLights !== undefined)
        turf.facilities.ledLights =
          req.body.ledLights === "true" || req.body.ledLights === true;
      if (req.body.lockerRooms !== undefined)
        turf.facilities.lockerRooms =
          req.body.lockerRooms === "true" || req.body.lockerRooms === true;
      if (req.body.shower !== undefined)
        turf.facilities.shower =
          req.body.shower === "true" || req.body.shower === true;
      if (req.body.restrooms !== undefined)
        turf.facilities.restrooms =
          req.body.restrooms === "true" || req.body.restrooms === true;
      if (req.body.grandstands !== undefined)
        turf.facilities.grandstands =
          req.body.grandstands === "true" || req.body.grandstands === true;
      if (req.body.coveredAreas !== undefined)
        turf.facilities.coveredAreas =
          req.body.coveredAreas === "true" || req.body.coveredAreas === true;
      if (req.body.parking !== undefined)
        turf.facilities.parking =
          req.body.parking === "true" || req.body.parking === true;
      if (req.body.foodCourt !== undefined)
        turf.facilities.foodCourt =
          req.body.foodCourt === "true" || req.body.foodCourt === true;
      if (req.body.coldDrinks !== undefined)
        turf.facilities.coldDrinks =
          req.body.coldDrinks === "true" || req.body.coldDrinks === true;
      if (req.body.drinkingWater !== undefined)
        turf.facilities.drinkingWater =
          req.body.drinkingWater === "true" || req.body.drinkingWater === true;
      if (req.body.wifi !== undefined)
        turf.facilities.wifi =
          req.body.wifi === "true" || req.body.wifi === true;
      if (req.body.loungeArea !== undefined)
        turf.facilities.loungeArea =
          req.body.loungeArea === "true" || req.body.loungeArea === true;
      if (req.body.surveillanceCameras !== undefined)
        turf.facilities.surveillanceCameras =
          req.body.surveillanceCameras === "true" ||
          req.body.surveillanceCameras === true;
      if (req.body.securityPersonnel !== undefined)
        turf.facilities.securityPersonnel =
          req.body.securityPersonnel === "true" ||
          req.body.securityPersonnel === true;
      if (req.body.firstAidKit !== undefined)
        turf.facilities.firstAidKit =
          req.body.firstAidKit === "true" || req.body.firstAidKit === true;

      await turf.save();

      res.json({
        message: "Turf updated successfully",
        turf,
      });
    } catch (error) {
      console.error("Error updating turf:", error);

      // Clean up any uploaded files in case of error
      if (req.files) {
        for (const file of req.files) {
          await cleanupFile(file.path);
        }
      }

      res.status(500).json({
        message: "Failed to update turf",
        error: error.message,
      });
    }
  },

  // Delete a turf
  deleteTurf: async (req, res) => {
    try {
      // Get userId from query parameters
      const userId = req.query.userId;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const turf = await Turf.findById(req.params.id);

      if (!turf) {
        return res.status(404).json({ message: "Turf not found" });
      }

      // Check permissions - only owner can delete
      if (turf.owner.toString() !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Insufficient permissions" });
      }

      // Delete all associated images
      if (turf.images && turf.images.length > 0) {
        for (const imagePath of turf.images) {
          // Ensure imagePath is a string and not undefined
          if (typeof imagePath === "string") {
            const fullPath = path.join(turfsDir, path.basename(imagePath));
            await cleanupFile(fullPath);
          }
        }
      }

      await Turf.findByIdAndDelete(req.params.id);

      res.json({ message: "Turf deleted successfully" });
    } catch (error) {
      console.error("Error deleting turf:", error);
      res.status(500).json({
        message: "Failed to delete turf",
        error: error.message,
      });
    }
  },

  // Add a review to a turf
  addReview: async (req, res) => {
    try {
      const { rating, comment, userId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      if (!rating || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ message: "Invalid rating. Must be between 1 and 5" });
      }

      const turf = await Turf.findById(req.params.id);

      if (!turf) {
        return res.status(404).json({ message: "Turf not found" });
      }

      // Check if user has already reviewed this turf
      const existingReviewIndex = turf.reviews.findIndex(
        (review) => review.user.toString() === userId
      );

      if (existingReviewIndex !== -1) {
        // Update existing review
        turf.reviews[existingReviewIndex].rating = rating;
        turf.reviews[existingReviewIndex].comment = comment;
      } else {
        // Add new review
        turf.reviews.push({
          user: userId,
          rating,
          comment,
        });
      }

      // Recalculate average rating
      const totalRating = turf.reviews.reduce(
        (sum, review) => sum + review.rating,
        0
      );
      turf.ratings.average = totalRating / turf.reviews.length;
      turf.ratings.count = turf.reviews.length;

      await turf.save();

      res.json({
        message: "Review added successfully",
        review: turf.reviews[turf.reviews.length - 1],
      });
    } catch (error) {
      console.error("Error adding review:", error);
      res.status(500).json({
        message: "Failed to add review",
        error: error.message,
      });
    }
  },

  // Get all turfs owned by the current user
  getUserTurfs: async (req, res) => {
    try {
      // Get userId from query params instead of req.user
      const userId = req.query.userId;

      if (!userId) {
        return res
          .status(400)
          .json({ message: "User ID is required as a query parameter" });
      }

      const turfs = await Turf.find({ owner: userId })
        .sort({ createdAt: -1 })
        .lean();

      res.json(turfs);
    } catch (error) {
      console.error("Error fetching owner turfs:", error);
      res.status(500).json({
        message: "Failed to fetch your turfs",
        error: error.message,
      });
    }
  },

  // Toggle turf active status
  toggleTurfStatus: async (req, res) => {
    try {
      // Get userId from query parameters
      const userId = req.query.userId;
      const { isActive } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      if (isActive === undefined) {
        return res.status(400).json({ message: "isActive status is required" });
      }

      const turf = await Turf.findById(req.params.id);

      if (!turf) {
        return res.status(404).json({ message: "Turf not found" });
      }

      // Check permissions - only owner can toggle status
      if (turf.owner.toString() !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Insufficient permissions" });
      }

      // Update active status
      turf.isActive = isActive;
      await turf.save();

      res.json({
        message: `Turf ${isActive ? "activated" : "deactivated"} successfully`,
        turf,
      });
    } catch (error) {
      console.error("Error updating turf status:", error);
      res.status(500).json({
        message: "Failed to update turf status",
        error: error.message,
      });
    }
  },

  // Assign Manager to turf
  assignManager: async (req, res) => {
    try {
      const { id } = req.params;
      const { managerId } = req.body;

      // Validate inputs
      if (!managerId) {
        return res.status(400).json({ error: "Manager ID is required" });
      }

      // Find the turf
      const turf = await Turf.findById(id);
      if (!turf) {
        return res.status(404).json({ error: "Turf not found" });
      }

      // Check if manager exists and is active
      const manager = await Manager.findById(managerId);
      if (!manager) {
        return res.status(404).json({ error: "Manager not found" });
      }

      if (!manager.isActive) {
        return res.status(400).json({ error: "Manager is not active" });
      }

      // Check if manager is already assigned to this turf
      if (turf.assignedManagers && turf.assignedManagers.includes(managerId)) {
        return res
          .status(400)
          .json({ error: "Manager already assigned to this turf" });
      }

      // Add manager to turf
      turf.assignedManagers = turf.assignedManagers || [];
      turf.assignedManagers.push(managerId);
      await turf.save();

      res.status(200).json({
        message: "Manager assigned successfully",
        turf: await Turf.findById(id).populate(
          "assignedManagers",
          "name email isActive"
        ),
      });
    } catch (error) {
      console.error("Error assigning manager:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  },

  // Remove manager from turf
  removeManager: async (req, res) => {
    try {
      const { id, managerId } = req.params;

      // Find the turf
      const turf = await Turf.findById(id);
      if (!turf) {
        return res.status(404).json({ error: "Turf not found" });
      }

      // Check if manager is actually assigned to this turf
      if (
        !turf.assignedManagers ||
        !turf.assignedManagers.includes(managerId)
      ) {
        return res
          .status(400)
          .json({ error: "Manager is not assigned to this turf" });
      }

      // Remove manager from turf
      turf.assignedManagers = turf.assignedManagers.filter(
        (assignedId) => assignedId.toString() !== managerId
      );
      await turf.save();

      res.status(200).json({
        message: "Manager removed successfully",
        turf: await Turf.findById(id).populate(
          "assignedManagers",
          "name email isActive"
        ),
      });
    } catch (error) {
      console.error("Error removing manager:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  },

  // Fetch assigned turfs for manager role
  getManagerAssignedTurfs: async (req, res) => {
    try {
      const { managerId } = req.params;

      if (!managerId) {
        return res.status(400).json({ message: "Manager ID is required" });
      }

      // Find all turfs where this manager is assigned
      const turfs = await Turf.find({
        assignedManagers: managerId,
        isActive: true,
      })
        .populate("owner", "name email clubName")
        .sort({ createdAt: -1 })
        .lean();

      res.json({
        turfs,
        total: turfs.length,
      });
    } catch (error) {
      console.error("Error fetching manager assigned turfs:", error);
      res.status(500).json({
        message: "Failed to fetch assigned turfs",
        error: error.message,
      });
    }
  },
};

module.exports = turfController;