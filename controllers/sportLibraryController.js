const SportLibrary = require("../src/modules/catalog/models/SportLibrary");

// GET /api/sport-library — public list (active only by default; ?all=true for admin)
exports.getAll = async (req, res) => {
  try {
    const { all, search } = req.query;
    const filter = {};
    if (all !== "true") filter.isActive = true;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    const sports = await SportLibrary.find(filter)
      .sort({ order: 1, name: 1 })
      .lean();
    res.json({ success: true, data: sports });
  } catch (error) {
    console.error("Error fetching sport library:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sports.",
      error: error.message,
    });
  }
};

// GET /api/sport-library/:idOrSlug — detail (by _id or slug)
exports.getOne = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const query = idOrSlug.match(/^[0-9a-fA-F]{24}$/)
      ? { _id: idOrSlug }
      : { slug: idOrSlug.toLowerCase() };
    const sport = await SportLibrary.findOne(query).lean();
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found." });
    }
    res.json({ success: true, data: sport });
  } catch (error) {
    console.error("Error fetching sport:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sport.",
      error: error.message,
    });
  }
};

// POST /api/sport-library — create (admin)
exports.create = async (req, res) => {
  try {
    if (!req.body.name) {
      return res
        .status(400)
        .json({ success: false, message: "Sport name is required." });
    }
    const sport = await SportLibrary.create(req.body);
    res
      .status(201)
      .json({ success: true, message: "Sport created.", data: sport });
  } catch (error) {
    console.error("Error creating sport:", error);
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "A sport with that name already exists." });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create sport.",
      error: error.message,
    });
  }
};

// PUT /api/sport-library/:id — update (admin)
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    // Never trust client-sent slug/_id collisions; let slug regenerate if name changed
    const payload = { ...req.body };
    delete payload._id;
    const sport = await SportLibrary.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found." });
    }
    res.json({ success: true, message: "Sport updated.", data: sport });
  } catch (error) {
    console.error("Error updating sport:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update sport.",
      error: error.message,
    });
  }
};

// DELETE /api/sport-library/:id — delete (admin)
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const sport = await SportLibrary.findByIdAndDelete(id);
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found." });
    }
    res.json({ success: true, message: "Sport deleted." });
  } catch (error) {
    console.error("Error deleting sport:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete sport.",
      error: error.message,
    });
  }
};

// PATCH /api/sport-library/:id/toggle — flip isActive (admin)
exports.toggleActive = async (req, res) => {
  try {
    const { id } = req.params;
    const sport = await SportLibrary.findById(id);
    if (!sport) {
      return res
        .status(404)
        .json({ success: false, message: "Sport not found." });
    }
    sport.isActive = !sport.isActive;
    await sport.save();
    res.json({ success: true, message: "Sport status updated.", data: sport });
  } catch (error) {
    console.error("Error toggling sport:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle sport.",
      error: error.message,
    });
  }
};
