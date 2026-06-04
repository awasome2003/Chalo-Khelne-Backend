const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // "image" stories have `image` set to the relative upload path
    // (e.g. "stories/storyImage-12345.jpg"). "text" stories have `text`,
    // `bgColor`, and `fontFamily`.
    type: {
      type: String,
      enum: ["image", "text"],
      required: true,
    },
    image: { type: String, default: null },
    text: { type: String, default: "" },
    bgColor: { type: String, default: "#2D3E4E" },
    fontFamily: { type: String, default: "System" },

    // Set of userIds that have viewed this story (for view counts later).
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Stories expire after 24h on the feed. A separate cron job will hard-delete
// docs older than 7 days for cleanup.
storySchema.index({ createdAt: -1 });
storySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Story", storySchema);
