const express = require("express");
const router = express.Router();
const { createInquiry, getAllInquiries, updateInquiryStatus } = require("../controllers/InquiryController");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

// POST - Submit a new inquiry (public contact form)
router.post("/", createInquiry);

// GET - Get all inquiries — superadmin only
router.get("/", requireSuperAdmin, getAllInquiries);

// PUT - Update inquiry status — superadmin only
router.put("/:id/status", requireSuperAdmin, updateInquiryStatus);

module.exports = router;
