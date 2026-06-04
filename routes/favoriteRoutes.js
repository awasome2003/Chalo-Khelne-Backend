const express = require("express");
const router = express.Router();
const favoriteController = require("../controllers/favoriteController");
const { authenticate } = require("../middleware/authMiddleware");

// ── All favorite routes require a valid user token ──
router.use(authenticate);

/**
 * forceSelfId — favorites are strictly per-user. The controllers read the user
 * id from req.query.userId / req.body.userId, which previously let a client act
 * on ANY user's favorites. We overwrite both with the authenticated caller's id
 * so the client-supplied value is ignored (closes the IDOR).
 */
const forceSelfId = (req, res, next) => {
  const me = String(req.user.id || req.user._id);
  if (req.query && typeof req.query === "object") req.query.userId = me;
  if (req.body && typeof req.body === "object") req.body.userId = me;
  next();
};

// Get user favorites (reads req.query.userId)
router.get("/favorites", forceSelfId, favoriteController.getUserFavorites);

// Toggle favorite status (reads req.body.userId)
router.post("/favorites/toggle", forceSelfId, favoriteController.toggleFavorite);

// Check if a turf is a favorite (reads req.query.userId + turfId)
router.get("/favorites/check", forceSelfId, favoriteController.checkFavorite);

// Legacy alias — :userId in the path is IGNORED; the caller's own id is used.
router.get("/user-favorites/:userId", forceSelfId, (req, res) => {
  favoriteController.getUserFavorites(req, res);
});

module.exports = router;
