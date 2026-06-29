const mongoose = require("mongoose");

const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "Tournament Announcement",
        "Sports News",
        "Club Updates",
        "Training Announcement",
      ],
    },
    status: {
      type: String,
      enum: ["Draft", "Published", "Expired", "Archived"],
      default: "Draft",
    },
    sports: [
      {
        type: String,
        trim: true,
      },
    ],
    region: {
      type: String,
      trim: true,
    },
    area: {
      type: String,
      trim: true,
    },
    thumbnail: {
      type: String,
      default: null,
    },
    publishDate: {
      type: Date,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "createdByModel",
    },
    createdByModel: {
      type: String,
      required: true,
      enum: ["User", "Manager"],
    },
    createdByName: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
newsSchema.index({ status: 1 });
newsSchema.index({ type: 1 });
newsSchema.index({ sports: 1 });
newsSchema.index({ region: 1, area: 1 });
newsSchema.index({ publishDate: -1 });
newsSchema.index({ createdBy: 1 });

module.exports = mongoose.model("News", newsSchema);
