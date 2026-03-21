const Post = require('../Modal/Post');
const Tournament = require('../Modal/Tournament'); // Add Tournament model
const User = require('../Modal/User'); // Add User model
const { Manager } = require('../Modal/ClubManager'); // Add Manager model
const axios = require('axios');
const cheerio = require('cheerio');
const { default: mongoose } = require('mongoose');

// Helper function to fetch link preview data
const fetchLinkPreview = async (url) => {
  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const getMetaTag = (name) => {
      return $(`meta[name=${name}]`).attr('content') ||
        $(`meta[property="og:${name}"]`).attr('content') ||
        $(`meta[property="twitter:${name}"]`).attr('content');
    };

    return {
      title: getMetaTag('title') || $('title').text(),
      description: getMetaTag('description'),
      image: getMetaTag('image'),
      url: url
    };
  } catch (error) {
    console.error('Error fetching link preview:', error);
    return null;
  }
};

exports.createPost = async (req, res) => {
  try {
    const { tournamentName, caption, tags, location, link } = req.body;

    // 1. Check if tournament exists in DB - search by title or name (case-insensitive)
    const tournament = await Tournament.findOne({
      $or: [
        { title: { $regex: new RegExp(`^${tournamentName.trim()}$`, 'i') } },
        { name: { $regex: new RegExp(`^${tournamentName.trim()}$`, 'i') } }
      ]
    });

    if (!tournament) {
      console.log("Post creation failed: Tournament not found ->", tournamentName);
      return res.status(400).json({
        message: `Tournament "${tournamentName}" not found. Please select from the suggestions.`
      });
    }

    // 2. Validate tags if provided (optional validation)
    let tagList = [];
    if (tags) {
      tagList = Array.isArray(tags) ? tags : [tags];
      // We'll keep the tags as strings even if users aren't found in DB, 
      // but let's log any that aren't found if we want to be helpful.
    }

    // 3. Fetch link preview if link is provided
    let linkPreview = null;
    if (link) {
      linkPreview = await fetchLinkPreview(link);
    }

    // 4. Create post
    const post = new Post({
      tournamentName: tournament.title || tournament.name || tournamentName,
      caption,
      tags: tagList,
      location,
      link,
      linkPreview,
      user: req.user.id,
      userModel: req.user.role === 'Manager' ? 'Manager' : 'User' // Set correct model if available in token
    });

    await post.save();
    res.status(201).json(post);

  } catch (error) {
    console.error("Create post error:", error);
    res.status(400).json({ message: error.message });
  }
};

// Rest of the controller remains the same
exports.getAllPosts = async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('user', 'name profileImage')
      .populate('likes', 'name')
      .populate('saves', 'name')
      .populate({
        path: 'comments.user',
        select: 'name profileImage'
      })
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.user.id;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const likeIndex = post.likes.indexOf(userId);
    if (likeIndex === -1) {
      post.likes.push(userId);
    } else {
      post.likes.splice(likeIndex, 1);
    }

    await post.save();
    res.json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleSave = async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.user.id;

    // Find the post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Try to find user in both User and Manager models
    let user = await User.findById(userId);
    let isManager = false;

    if (!user) {
      user = await Manager.findById(userId);
      isManager = true;
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if post is already saved
    const saveIndex = post.saves.indexOf(userId);
    const userSaveIndex = user.savedPosts ? user.savedPosts.indexOf(postId) : -1;

    if (saveIndex === -1) {
      // Save the post
      post.saves.push(userId);
      if (!user.savedPosts) {
        user.savedPosts = [];
      }
      user.savedPosts.push(postId);
    } else {
      // Unsave the post
      post.saves.splice(saveIndex, 1);
      if (userSaveIndex !== -1) {
        user.savedPosts.splice(userSaveIndex, 1);
      }
    }

    // Save both documents
    await post.save();
    await user.save();

    res.json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/posts/:userId
exports.getPostsByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // 👇 correct field name
    const posts = await Post.find({ user: userId }).sort({ createdAt: -1 }).populate('user', 'name profileImage');

    res.json({ success: true, posts });
  } catch (err) {
    console.error("Error fetching user posts:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/posts/saved/:userId
exports.getSavedPostsByUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Try to find user in both User and Manager models
    let user = await User.findById(userId).populate({
      path: 'savedPosts',
      populate: {
        path: 'user',
        select: 'name profileImage email'
      },
      options: { sort: { createdAt: -1 } }
    });

    if (!user) {
      // Try Manager model
      user = await Manager.findById(userId).populate({
        path: 'savedPosts',
        populate: {
          path: 'user',
          select: 'name profileImage email'
        },
        options: { sort: { createdAt: -1 } }
      });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, posts: user.savedPosts || [] });
  } catch (err) {
    console.error("Error fetching saved posts:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Comment text is required" });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const newComment = {
      user: userId,
      text: text,
      createdAt: new Date()
    };

    post.comments.push(newComment);
    await post.save();

    // Populate user details for the new comment to return it immediately
    await post.populate({
      path: 'comments.user',
      select: 'name profileImage'
    });

    res.status(201).json({
      success: true,
      comments: post.comments,
      newComment: post.comments[post.comments.length - 1]
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Check if the user is the owner of the post
    // Note: post.user is an ObjectId
    if (post.user.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized to delete this post" });
    }

    await Post.findByIdAndDelete(postId);
    res.json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ message: error.message });
  }
};
