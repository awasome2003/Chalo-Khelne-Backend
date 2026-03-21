const Sport = require("../Modal/Sport");
const Tournament = require("../Modal/Tournament");
const Turf = require("../Modal/Turf");
const Session = require("../Modal/Session");
const { sportPresets } = require("../Config/sportPresets");

// 1. Create a new sport
exports.createSport = async (req, res) => {
  try {
    const { name, category, scoringType, matchFormat, displayConfig } =
      req.body;

    if (!name || !category || !scoringType) {
      return res.status(400).json({
        success: false,
        message: "name, category, and scoringType are required",
      });
    }

    const existing = await Sport.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Sport already exists" });
    }

    const sport = new Sport({
      name,
      category,
      scoringType,
      matchFormat: matchFormat || {},
      displayConfig: displayConfig || {},
    });
    await sport.save();

    res
      .status(201)
      .json({ success: true, message: "Sport created successfully", data: sport });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 2. Update sport details (name, category, isActive)
exports.updateSport = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, scoringType, isActive } = req.body;

    const sport = await Sport.findById(id);
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found" });
    }

    if (name !== undefined) sport.name = name;
    if (category !== undefined) sport.category = category;
    if (scoringType !== undefined) sport.scoringType = scoringType;
    if (isActive !== undefined) sport.isActive = isActive;

    // Regenerate slug if name changed
    if (name !== undefined) {
      sport.slug = name.toLowerCase().replace(/\s+/g, "-");
    }

    await sport.save();

    res.json({ success: true, message: "Sport updated successfully", data: sport });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 3. Update sport config (matchFormat + displayConfig)
exports.updateSportConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { matchFormat, displayConfig } = req.body;

    if (!matchFormat && !displayConfig) {
      return res.status(400).json({
        success: false,
        message: "At least matchFormat or displayConfig is required",
      });
    }

    const sport = await Sport.findById(id);
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found" });
    }

    if (matchFormat) {
      sport.matchFormat = { ...sport.matchFormat.toObject(), ...matchFormat };
    }
    if (displayConfig) {
      sport.displayConfig = {
        ...sport.displayConfig.toObject(),
        ...displayConfig,
      };
    }

    await sport.save();

    res.json({
      success: true,
      message: "Sport config updated successfully",
      data: sport,
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 4. Get all sports (with optional category filter)
exports.getAllSports = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};

    const sports = await Sport.find(filter).sort({ name: 1 }).lean();

    res.json({ success: true, data: sports });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 5. Get only active sports
exports.getActiveSports = async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { isActive: true };
    if (category) filter.category = category;

    const sports = await Sport.find(filter).sort({ name: 1 }).lean();

    res.json({ success: true, data: sports });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 6. Get sport presets (from config file, not DB)
exports.getSportPresets = async (req, res) => {
  try {
    res.json({ success: true, data: sportPresets });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 7. Get default match format for a sport by name/slug
exports.getDefaultFormat = async (req, res) => {
  try {
    const { sportName } = req.params;
    const slug = sportName.toLowerCase().replace(/\s+/g, "-");

    // Check DB first
    const sport = await Sport.findOne({
      $or: [
        { slug },
        { name: { $regex: new RegExp(`^${sportName}$`, "i") } },
      ],
    }).lean();

    if (sport) {
      return res.json({
        success: true,
        data: {
          name: sport.name,
          scoringType: sport.scoringType,
          matchFormat: sport.matchFormat,
          displayConfig: sport.displayConfig,
        },
      });
    }

    // Fallback to presets
    const preset = sportPresets.find(
      (p) => p.slug === slug || p.name.toLowerCase() === sportName.toLowerCase()
    );

    if (!preset) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found" });
    }

    res.json({
      success: true,
      data: {
        name: preset.name,
        scoringType: preset.scoringType,
        matchFormat: preset.matchFormat,
        displayConfig: preset.displayConfig,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 8. Seed sports database with all 15 presets
exports.seedSports = async (req, res) => {
  try {
    const results = { created: 0, updated: 0, errors: [] };

    for (const preset of sportPresets) {
      try {
        const existing = await Sport.findOne({ slug: preset.slug });

        if (existing) {
          // Update existing sport with latest preset data
          existing.category = preset.category;
          existing.scoringType = preset.scoringType;
          existing.matchFormat = preset.matchFormat;
          existing.displayConfig = preset.displayConfig;
          existing.isPreset = true;
          await existing.save();
          results.updated++;
        } else {
          // Create new sport
          const sport = new Sport({
            ...preset,
            isPreset: true,
            isActive: true,
          });
          await sport.save();
          results.created++;
        }
      } catch (err) {
        results.errors.push({ sport: preset.name, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Seed complete: ${results.created} created, ${results.updated} updated`,
      data: results,
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 9. Get tournaments by sport name
exports.getTournamentsBySport = async (req, res) => {
  try {
    const { sportName } = req.params;

    const tournaments = await Tournament.find({
      sportsType: { $regex: new RegExp(sportName, "i") },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: tournaments });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 10. Get venues (turfs) by sport name
exports.getVenuesBySport = async (req, res) => {
  try {
    const { sportName } = req.params;

    const venues = await Turf.find({
      "sports.name": { $regex: new RegExp(sportName, "i") },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: venues });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 11. Get training sessions by sport name
exports.getTrainingBySport = async (req, res) => {
  try {
    const { sportName } = req.params;

    const sessions = await Session.find({
      sportType: { $regex: new RegExp(sportName, "i") },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: sessions });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
