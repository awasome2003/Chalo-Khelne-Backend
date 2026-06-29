const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  tournamentName: { type: String, required: true },
  caption: { type: String, required: true },
  tags: [{ type: String }],
  location: { type: String },
  link: { type: String },
  linkPreview: {
    title: String,
    description: String,
    image: String,
    url: String
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'userModel'
  },
  userModel: {
    type: String,
    required: true,
    enum: ['User', 'Manager'] 
  },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  saves: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);
