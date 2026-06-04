/**
 * Follow controller — Instagram-style public (instant) follow.
 * Relationship is stored as two arrays on User: `following` and `followers`.
 */
const mongoose = require("mongoose");
const User = require("../Modal/User");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/follow/:targetId/toggle  — follow if not following, else unfollow.
exports.toggleFollow = async (req, res) => {
  try {
    const me = req.user.id;
    const target = req.params.targetId;

    if (!isValidId(target)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    if (String(me) === String(target)) {
      return res.status(400).json({ success: false, message: "You can't follow yourself" });
    }

    const targetUser = await User.findById(target).select("_id followers");
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const meDoc = await User.findById(me).select("following");
    const alreadyFollowing = (meDoc.following || []).some((id) => String(id) === String(target));

    if (alreadyFollowing) {
      await User.updateOne({ _id: me }, { $pull: { following: target } });
      await User.updateOne({ _id: target }, { $pull: { followers: me } });
    } else {
      await User.updateOne({ _id: me }, { $addToSet: { following: target } });
      await User.updateOne({ _id: target }, { $addToSet: { followers: me } });
    }

    const fresh = await User.findById(target).select("followers following");
    return res.json({
      success: true,
      following: !alreadyFollowing,
      followersCount: (fresh.followers || []).length,
      followingCount: (fresh.following || []).length,
    });
  } catch (err) {
    console.error("[FOLLOW] toggle error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/follow/:userId/status — am I (req.user) following :userId? + counts.
exports.getStatus = async (req, res) => {
  try {
    const me = req.user.id;
    const target = req.params.userId;
    if (!isValidId(target)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const t = await User.findById(target).select(
      "followers following name profileImage bio role"
    );
    if (!t) return res.status(404).json({ success: false, message: "User not found" });

    const isFollowing = (t.followers || []).some((id) => String(id) === String(me));
    return res.json({
      success: true,
      isFollowing,
      isSelf: String(me) === String(target),
      followersCount: (t.followers || []).length,
      followingCount: (t.following || []).length,
      user: {
        _id: t._id,
        name: t.name,
        profileImage: t.profileImage,
        bio: t.bio,
        role: t.role,
      },
    });
  } catch (err) {
    console.error("[FOLLOW] status error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Tag each user with whether the CALLER follows them + whether it's the caller.
async function decorateWithMyStatus(callerId, users) {
  const meDoc = await User.findById(callerId).select("following");
  const myFollowing = new Set((meDoc?.following || []).map(String));
  return (users || []).map((x) => ({
    _id: x._id,
    name: x.name,
    profileImage: x.profileImage,
    role: x.role,
    isFollowing: myFollowing.has(String(x._id)),
    isSelf: String(x._id) === String(callerId),
  }));
}

// GET /api/follow/search?q= — find users by name (for discovery / following).
exports.searchUsers = async (req, res) => {
  try {
    const me = req.user.id;
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ success: true, users: [] });

    // Escape regex special chars in the query.
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = await User.find({
      _id: { $ne: me },
      name: { $regex: safe, $options: "i" },
    })
      .select("name profileImage role")
      .limit(20);

    const users = await decorateWithMyStatus(me, found);
    return res.json({ success: true, users });
  } catch (err) {
    console.error("[FOLLOW] search error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/follow/:userId/followers — list of users who follow :userId.
exports.getFollowers = async (req, res) => {
  try {
    const target = req.params.userId;
    if (!isValidId(target)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const u = await User.findById(target).populate("followers", "name profileImage role");
    if (!u) return res.status(404).json({ success: false, message: "User not found" });
    const users = await decorateWithMyStatus(req.user.id, u.followers);
    return res.json({ success: true, users });
  } catch (err) {
    console.error("[FOLLOW] followers error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/follow/:userId/following — list of users :userId follows.
exports.getFollowing = async (req, res) => {
  try {
    const target = req.params.userId;
    if (!isValidId(target)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const u = await User.findById(target).populate("following", "name profileImage role");
    if (!u) return res.status(404).json({ success: false, message: "User not found" });
    const users = await decorateWithMyStatus(req.user.id, u.following);
    return res.json({ success: true, users });
  } catch (err) {
    console.error("[FOLLOW] following error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
