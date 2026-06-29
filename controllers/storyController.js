const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Story = require("../src/modules/social/models/Story");
const { storiesDir, cleanupFile, getRelativePath } = require("../middleware/uploads");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const isActive = (story) =>
  Date.now() - new Date(story.createdAt).getTime() < ONE_DAY_MS;

const shapeStory = (doc, currentUserId) => {
  const obj = doc.toObject ? doc.toObject({ virtuals: false }) : doc;
  return {
    id: String(obj._id),
    type: obj.type,
    image: obj.image || null,
    text: obj.text || "",
    bgColor: obj.bgColor || "#2D3E4E",
    fontFamily: obj.fontFamily || "System",
    createdAt: obj.createdAt,
    user: obj.user && typeof obj.user === "object"
      ? {
          _id: String(obj.user._id),
          name: obj.user.name,
          profileImage: obj.user.profileImage || null,
        }
      : { _id: String(obj.user) },
    viewersCount: Array.isArray(obj.viewers) ? obj.viewers.length : 0,
    hasViewed:
      currentUserId &&
      Array.isArray(obj.viewers) &&
      obj.viewers.some((v) => String(v) === String(currentUserId)),
  };
};

// POST /api/stories — create a story (image or text).
// Image stories: multipart form with field `storyImage`.
// Text stories: JSON body with { type: "text", text, bgColor, fontFamily }.
exports.createStory = async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const type = body.type === "text" ? "text" : req.file ? "image" : null;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Story must be either type=text with text body, or include a storyImage file",
      });
    }

    let story;
    if (type === "image") {
      const relPath = getRelativePath(req.file.path);
      story = await Story.create({
        user: userId,
        type: "image",
        image: relPath,
      });
    } else {
      const text = String(body.text || "").trim();
      if (!text) {
        return res
          .status(400)
          .json({ success: false, message: "Text stories require non-empty text" });
      }
      story = await Story.create({
        user: userId,
        type: "text",
        text,
        bgColor: body.bgColor || "#2D3E4E",
        fontFamily: body.fontFamily || "System",
      });
    }

    await story.populate("user", "name profileImage");
    return res.status(201).json({ success: true, story: shapeStory(story, userId) });
  } catch (err) {
    console.error("[stories] createStory failed:", err);
    if (req.file?.path) cleanupFile(req.file.path);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/stories/mine — current user's own active stories (< 24h old).
exports.getMyStories = async (req, res) => {
  try {
    const userId = req.user.id;
    const cutoff = new Date(Date.now() - ONE_DAY_MS);
    const stories = await Story.find({
      user: userId,
      createdAt: { $gte: cutoff },
    })
      .populate("user", "name profileImage")
      .sort({ createdAt: 1 });
    return res.json({ success: true, stories: stories.map((s) => shapeStory(s, userId)) });
  } catch (err) {
    console.error("[stories] getMyStories failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/stories/feed — active stories from everyone EXCEPT the current user,
// grouped by user so the UI can render one circle per user.
exports.getStoriesFeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const cutoff = new Date(Date.now() - ONE_DAY_MS);

    // Story privacy: a story is visible to its author's followers + following.
    // From the viewer's side that means I only see stories from users I follow
    // OR who follow me (the union of my following + followers).
    const User = require("../src/modules/identity/models/User");
    const me = await User.findById(userId).select("followers following");
    const audience = new Set([
      ...(me?.following || []).map(String),
      ...(me?.followers || []).map(String),
    ]);
    audience.delete(String(userId));
    const allowedAuthorIds = Array.from(audience);

    const stories = await Story.find({
      user: { $in: allowedAuthorIds },
      createdAt: { $gte: cutoff },
    })
      .populate("user", "name profileImage")
      .sort({ createdAt: 1 });

    // Group by user
    const byUser = new Map();
    for (const s of stories) {
      const uid = String(s.user?._id || s.user);
      if (!byUser.has(uid)) {
        byUser.set(uid, {
          userId: uid,
          name: s.user?.name || "User",
          profileImage: s.user?.profileImage || null,
          stories: [],
        });
      }
      byUser.get(uid).stories.push(shapeStory(s, userId));
    }

    return res.json({ success: true, groups: Array.from(byUser.values()) });
  } catch (err) {
    console.error("[stories] getStoriesFeed failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/stories/:id — delete one story (owner only). Removes the
// uploaded file too if the story is an image.
exports.deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid story id" });
    }

    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }
    // The story owner, or a SuperAdmin (platform moderation), may delete it.
    const actorId = req.user.id || req.user._id;
    const isSuperAdmin =
      req.isSuperAdmin === true ||
      String(req.user?.role || "").toLowerCase() === "superadmin";
    if (String(story.user) !== String(actorId) && !isSuperAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden — not your story" });
    }

    if (story.type === "image" && story.image) {
      const absolute = path.join(storiesDir, "..", story.image);
      try {
        if (fs.existsSync(absolute)) await fs.promises.unlink(absolute);
      } catch (e) {
        console.warn("[stories] unable to remove image file:", e.message);
      }
    }

    await story.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    console.error("[stories] deleteStory failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/stories/:id/view — record that the current user viewed this story.
exports.markViewed = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid story id" });
    }
    const userId = req.user.id;
    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }
    if (!story.viewers.some((v) => String(v) === String(userId))) {
      story.viewers.push(userId);
      await story.save();
    }
    return res.json({ success: true, viewersCount: story.viewers.length });
  } catch (err) {
    console.error("[stories] markViewed failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
