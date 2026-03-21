const SportRuleBook = require("../Modal/SportRuleBook");
const Sport = require("../Modal/Sport");
const { sportRulePresets, LEVELS } = require("../Config/sportRulePresets");

// 1. Seed all rule book presets into DB
exports.seedRuleBooks = async (req, res) => {
  try {
    const results = { created: 0, updated: 0, errors: [] };

    // sportRulePresets is { "table-tennis": { district: {...}, state: {...}, ... }, ... }
    // We need to look up each sport by slug in the DB
    for (const [slug, levelPresets] of Object.entries(sportRulePresets)) {
      // Find sport by slug
      const sport = await Sport.findOne({ slug });

      if (!sport) {
        results.errors.push({
          sport: slug,
          error: `Sport with slug "${slug}" not found in DB. Seed sports first.`,
        });
        continue;
      }

      for (const level of LEVELS) {
        const preset = levelPresets[level];
        if (!preset) continue;

        try {
          const existing = await SportRuleBook.findOne({
            sportId: sport._id,
            level,
          });

          const fields = {
            gameStructureType: preset.gameStructureType || "sets",
            format: preset.format || {},
            scoring: preset.scoring || {},
            tieBreaker: preset.tieBreaker || {},
            participantConfig: preset.participantConfig || {},
            tournamentRules: preset.tournamentRules || {},
            rules: preset.rules || {},
            equipment: preset.equipment || {},
            description: preset.description || "",
            isDefault: true,
          };

          if (existing) {
            Object.assign(existing, fields);
            await existing.save();
            results.updated++;
          } else {
            const ruleBook = new SportRuleBook({
              sportId: sport._id,
              sportName: sport.name,
              level,
              ...fields,
            });
            await ruleBook.save();
            results.created++;
          }
        } catch (err) {
          results.errors.push({
            sport: sport.name,
            level,
            error: err.message,
          });
        }
      }
    }

    res.json({
      success: true,
      message: `Rule book seed complete: ${results.created} created, ${results.updated} updated`,
      data: results,
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 2. Get all rule books (with optional sport/level filter)
exports.getAllRuleBooks = async (req, res) => {
  try {
    const { sportName, level } = req.query;
    const filter = {};
    if (sportName) filter.sportName = { $regex: new RegExp(sportName, "i") };
    if (level) filter.level = level;

    const ruleBooks = await SportRuleBook.find(filter)
      .sort({ sportName: 1, level: 1 })
      .lean();

    res.json({ success: true, data: ruleBooks });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 3. Get rule book by sport and level (used when creating tournament)
exports.getRulesBysportAndLevel = async (req, res) => {
  try {
    const { sportName, level } = req.params;

    const ruleBook = await SportRuleBook.findOne({
      sportName: { $regex: new RegExp(`^${sportName}$`, "i") },
      level: level.toLowerCase(),
    }).lean();

    if (!ruleBook) {
      return res.status(404).json({
        success: false,
        message: `No rule book found for ${sportName} at ${level} level`,
      });
    }

    res.json({ success: true, data: ruleBook });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 4. Get all rule books for a specific sport (all levels)
exports.getRulesBySport = async (req, res) => {
  try {
    const { sportName } = req.params;

    const ruleBooks = await SportRuleBook.find({
      sportName: { $regex: new RegExp(`^${sportName}$`, "i") },
    })
      .sort({ level: 1 })
      .lean();

    res.json({ success: true, data: ruleBooks });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 5. Get a single rule book by ID
exports.getRuleBookById = async (req, res) => {
  try {
    const { id } = req.params;
    const ruleBook = await SportRuleBook.findById(id).lean();

    if (!ruleBook) {
      return res
        .status(404)
        .json({ success: false, message: "Rule book not found" });
    }

    res.json({ success: true, data: ruleBook });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 6. Get available levels for a sport (for dropdown in tournament form)
exports.getLevelsForSport = async (req, res) => {
  try {
    const { sportName } = req.params;

    const ruleBooks = await SportRuleBook.find({
      sportName: { $regex: new RegExp(`^${sportName}$`, "i") },
    })
      .select("level")
      .lean();

    const levels = ruleBooks.map((rb) => rb.level);

    res.json({ success: true, data: levels });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 7. Get presets from config (not DB)
exports.getRulePresets = async (req, res) => {
  try {
    res.json({ success: true, data: sportRulePresets });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};
