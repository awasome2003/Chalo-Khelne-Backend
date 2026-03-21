const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/', authenticate, postController.createPost);
router.get('/', postController.getAllPosts);
router.post('/:postId/like', authenticate, postController.toggleLike);
router.post('/:postId/save', authenticate, postController.toggleSave);
router.get('/saved/:userId', postController.getSavedPostsByUser);
router.post('/:postId/comments', authenticate, postController.addComment);
router.delete('/:postId', authenticate, postController.deletePost);
router.get("/:userId", postController.getPostsByUser);


module.exports = router;