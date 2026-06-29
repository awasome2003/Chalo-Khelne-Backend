// DeviceToken.js
const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  allowNotifications: {
    // Changed from isManager
    type: Boolean,
    required: true,
    default: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

// Add index for faster lookups
deviceTokenSchema.index({ token: 1, userId: 1 });

// Update middleware
deviceTokenSchema.pre("save", function (next) {
  if (!this.isNew) {
    this.lastUpdated = new Date();
  }
  next();
});

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
