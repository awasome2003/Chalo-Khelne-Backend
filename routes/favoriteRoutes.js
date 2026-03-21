const express = require("express");
const router = express.Router();
const favoriteController = require("../controllers/favoriteController");

// Get user favorites
router.get("/favorites", favoriteController.getUserFavorites);

// Toggle favorite status
router.post("/favorites/toggle", favoriteController.toggleFavorite);

router.get("/favorites/check", favoriteController.checkFavorite);

router.get("/user-favorites/:userId", (req, res) => {
  // Convert route param to query param
  req.query.userId = req.params.userId;
  // Call the existing controller function
  favoriteController.getUserFavorites(req, res);
});

module.exports = router;
