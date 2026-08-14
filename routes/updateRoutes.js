const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const Player = require("../src/modules/identity/models/Player");
const ClubManager = require("../src/modules/identity/models/ClubManager");
const ClubAdmin = require("../src/modules/identity/models/ClubAdmin");
const Organizer = require("../src/modules/tournaments/models/Organizermodel");
const User = require("../src/modules/identity/models/User");
const Inquiry = require("../src/modules/commerce/models/Inquiry");
const { requireSuperAdmin } = require("../middleware/authMiddleware");
const { parsePaging, pageMeta, searchFilter } = require("../utils/paginate");

// Every route in this file is a SuperAdmin control-plane action (approve/
// reject users, change roles, platform overview). Guard the whole router —
// any route added later inherits the gate automatically.
router.use(requireSuperAdmin);


router.put('/user-role/:id', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  console.log("⬅️ Role update requested for ID:", id, "to role:", role);

  try {
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    );

    if (!updatedUser) {
      console.log("❌ User not found");
      return res.status(404).json({ error: 'User not found' });
    }

    console.log("✅ Role updated to:", updatedUser.role);
    res.json(updatedUser);
  } catch (err) {
    console.error("❌ Error updating role:", err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});



router.get("/pending-approval", async (req, res) => {
  try {
    const filter = { isApproved: false, ...searchFilter(req, ["name", "email", "clubName"]) };
    const { paged, page, limit, skip } = parsePaging(req);
    // Legacy shape (no ?page/?limit) — untouched for existing callers.
    if (!paged) {
      const pendingUsers = await User.find(filter);
      return res.status(200).json(pendingUsers);
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return res.status(200).json({ items, ...pageMeta(total, page, limit) });
  } catch (error) {
    console.error("Error fetching pending users:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

router.post("/approve/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isApproved = true;
    await user.save();

    res.status(200).json({ message: "User approved successfully", user });
  } catch (error) {
    console.error("Error approving user:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

router.post("/reject/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Find and delete the user
    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({ message: "User not found or already deleted" });
    }

    res.status(200).json({ message: "User rejected and deleted successfully", user });
  } catch (error) {
    console.error("Error deleting (rejecting) user:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

router.get("/approved-users", async (req, res) => {
  try {
    const filter = { isApproved: true, ...searchFilter(req, ["name", "email", "clubName"]) };
    // Optional server-side role filter (so it spans the whole dataset, not just
    // the current page). "All"/empty = no role constraint.
    if (req.query.role && req.query.role !== "All") filter.role = req.query.role;
    const { paged, page, limit, skip } = parsePaging(req);
    if (!paged) {
      const approvedUsers = await User.find(filter);
      return res.status(200).json(approvedUsers);
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return res.status(200).json({ items, ...pageMeta(total, page, limit) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

router.get("/overview", async (req, res) => {
  try {
    const totalRequests = await User.countDocuments();
    const pending = await User.countDocuments({ isApproved: false });
    const approved = await User.countDocuments({ isApproved: true });

    // Role based statistics
    const players = await User.countDocuments({ role: "Player" });
    const trainers = await User.countDocuments({ role: "Trainer" });
    const clubAdmins = await User.countDocuments({ role: "ClubAdmin" });
    const corporateAdmins = await User.countDocuments({ role: "corporate_admin" });

    // Inquiry statistics
    const totalInquiries = await Inquiry.countDocuments();
    const pendingInquiries = await Inquiry.countDocuments({ status: "Pending" });

    res.json({
      totalRequests,
      pending,
      approved,
      stats: {
        players,
        trainers,
        clubAdmins,
        corporateAdmins,
        totalInquiries,
        pendingInquiries
      }
    });
  } catch (error) {
    console.error("Error in overview route:", error);
    res.status(500).json({ message: "Failed to fetch user overview" });
  }
});


// ✅ Update user approval status (true/false)
router.put("/user-status/:id", async (req, res) => {
  const { id } = req.params;
  const { isApproved } = req.body;

  console.log("RAW body:", req.body); // debug

  const isApprovedBool = isApproved === "true" || isApproved === true;

  try {
    const user = await User.findByIdAndUpdate(
      id,
      { isApproved: isApprovedBool },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "User approval status updated successfully", user });
  } catch (error) {
    console.error("Error updating user status:", error);
    res.status(500).json({ message: "Server error", error });
  }
});



module.exports = router;
