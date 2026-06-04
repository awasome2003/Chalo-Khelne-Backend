const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/plannerController");

// Notes CRUD
router.post("/", allowUserOrManager, ctrl.createNote);
router.put("/:id", allowUserOrManager, ctrl.updateNote);
router.delete("/:id", allowUserOrManager, ctrl.deleteNote);
router.get("/:id", allowUserOrManager, ctrl.getNoteById);

// Merged feed (notes + turf bookings + tournament registrations) for a user
router.get("/feed/:userId", allowUserOrManager, ctrl.getFeed);

module.exports = router;
