const express = require("express");
const router = express.Router();
const newsController = require("../controllers/newsController");
const { managerAuth, authenticate, allowUserOrManager } = require("../middleware/authMiddleware");

// Authenticated routes (static paths first)
router.get("/", allowUserOrManager, newsController.getAllNews);
router.post("/create", allowUserOrManager, newsController.createNews);
router.put("/update/:newsId", allowUserOrManager, newsController.updateNews);
router.delete("/delete/:newsId", allowUserOrManager, newsController.deleteNews);
router.post("/publish/:newsId", allowUserOrManager, newsController.publishNews);

// Public routes (static paths before param)
router.get("/active", newsController.getActiveNews);
router.get("/sport/:sportName", newsController.getNewsBySport);
router.get("/region", newsController.getNewsByRegion);

// Param route LAST — catches any /:newsId
router.get("/:newsId", newsController.getNewsById);

module.exports = router;
