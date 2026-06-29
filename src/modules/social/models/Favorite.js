const mongoose = require("mongoose");

const favoriteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // Each user has only ONE document for favorites
    },
    turfs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Turf",
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Favorite = mongoose.model("Favorite", favoriteSchema);

module.exports = Favorite;
