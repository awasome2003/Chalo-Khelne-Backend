const express = require("express");
const router = express.Router();
const { createInquiry, getAllInquiries, updateInquiryStatus } = require("../controllers/InquiryController");

// POST - Submit a new inquiry
router.post("/", createInquiry);

// GET - Get all inquiries (protected route logic can be added later)
router.get("/", getAllInquiries);

// PUT - Update inquiry status
router.put("/:id/status", updateInquiryStatus);

module.exports = router;
