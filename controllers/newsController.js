const News = require("../Modal/News");

// POST /api/news/create — Create news (Admin/Manager)
exports.createNews = async (req, res) => {
  try {
    const {
      title,
      body,
      type,
      sports,
      region,
      area,
      thumbnail,
      publishDate,
      expiryDate,
      createdByModel,
      createdByName,
    } = req.body;

    if (!title || !body || !type) {
      return res.status(400).json({
        success: false,
        message: "Title, body, and type are required.",
      });
    }

    const news = new News({
      title,
      body,
      type,
      sports: sports || [],
      region: region || null,
      area: area || null,
      thumbnail: thumbnail || null,
      publishDate: publishDate || null,
      expiryDate: expiryDate || null,
      createdBy: req.user.id || req.user._id,
      createdByModel: createdByModel || "Manager",
      createdByName: createdByName || "",
      status: "Draft",
    });

    await news.save();

    res.status(201).json({
      success: true,
      message: "News created successfully.",
      data: news,
    });
  } catch (error) {
    console.error("Error creating news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create news.",
      error: error.message,
    });
  }
};

// PUT /api/news/update/:newsId — Update news
exports.updateNews = async (req, res) => {
  try {
    const { newsId } = req.params;
    const updates = req.body;

    const news = await News.findById(newsId);
    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found.",
      });
    }

    // Only allow creator to update (or superadmin)
    if (
      news.createdBy.toString() !== (req.user.id || req.user._id).toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this news.",
      });
    }

    const allowedFields = [
      "title",
      "body",
      "type",
      "sports",
      "region",
      "area",
      "thumbnail",
      "publishDate",
      "expiryDate",
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        news[field] = updates[field];
      }
    });

    await news.save();

    res.json({
      success: true,
      message: "News updated successfully.",
      data: news,
    });
  } catch (error) {
    console.error("Error updating news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update news.",
      error: error.message,
    });
  }
};

// DELETE /api/news/delete/:newsId — Soft delete (archive)
exports.deleteNews = async (req, res) => {
  try {
    const { newsId } = req.params;

    const news = await News.findById(newsId);
    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found.",
      });
    }

    news.status = "Archived";
    await news.save();

    res.json({
      success: true,
      message: "News archived successfully.",
    });
  } catch (error) {
    console.error("Error deleting news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete news.",
      error: error.message,
    });
  }
};

// POST /api/news/publish/:newsId — Publish news
exports.publishNews = async (req, res) => {
  try {
    const { newsId } = req.params;

    const news = await News.findById(newsId);
    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found.",
      });
    }

    if (news.status === "Published") {
      return res.status(400).json({
        success: false,
        message: "News is already published.",
      });
    }

    news.status = "Published";
    news.publishDate = news.publishDate || new Date();
    await news.save();

    res.json({
      success: true,
      message: "News published successfully.",
      data: news,
    });
  } catch (error) {
    console.error("Error publishing news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to publish news.",
      error: error.message,
    });
  }
};

// GET /api/news/ — List all news (with pagination + filters)
exports.getAllNews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      sport,
      search,
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (type) filter.type = type;
    if (sport) filter.sports = sport;
    if (search) {
      filter.title = { $regex: search, $options: "i" };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await News.countDocuments(filter);

    const news = await News.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: news,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch news.",
      error: error.message,
    });
  }
};

// GET /api/news/active — Active (published, non-expired) news
exports.getActiveNews = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;

    const now = new Date();
    const filter = {
      status: "Published",
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    };

    if (type) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await News.countDocuments(filter);

    const news = await News.find(filter)
      .sort({ publishDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: news,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching active news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active news.",
      error: error.message,
    });
  }
};

// GET /api/news/sport/:sportName — News by sport
exports.getNewsBySport = async (req, res) => {
  try {
    const { sportName } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const filter = {
      sports: { $regex: new RegExp(`^${sportName}$`, "i") },
      status: "Published",
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await News.countDocuments(filter);

    const news = await News.find(filter)
      .sort({ publishDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: news,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching news by sport:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch news by sport.",
      error: error.message,
    });
  }
};

// GET /api/news/region — News by region (query params: region, area)
exports.getNewsByRegion = async (req, res) => {
  try {
    const { region, area, page = 1, limit = 20 } = req.query;

    const filter = { status: "Published" };
    if (region) filter.region = { $regex: new RegExp(`^${region}$`, "i") };
    if (area) filter.area = { $regex: new RegExp(`^${area}$`, "i") };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await News.countDocuments(filter);

    const news = await News.find(filter)
      .sort({ publishDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: news,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching news by region:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch news by region.",
      error: error.message,
    });
  }
};

// GET /api/news/:newsId — News details (increments view count)
exports.getNewsById = async (req, res) => {
  try {
    const { newsId } = req.params;

    const news = await News.findByIdAndUpdate(
      newsId,
      { $inc: { viewCount: 1 } },
      { new: true }
    ).lean();

    if (!news) {
      return res.status(404).json({
        success: false,
        message: "News not found.",
      });
    }

    res.json({
      success: true,
      data: news,
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch news.",
      error: error.message,
    });
  }
};
