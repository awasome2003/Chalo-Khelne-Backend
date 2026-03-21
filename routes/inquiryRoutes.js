const express = require("express");
const router = express.Router();
const { createInquiry, getAllInquiries } = require("../controllers/InquiryController");

// POST - Submit a new inquiry
router.post("/", createInquiry);

// GET - Get all inquiries (protected route logic can be added later)
router.get("/", getAllInquiries);

module.exports = router;
