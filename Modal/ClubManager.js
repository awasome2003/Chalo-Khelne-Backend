const mongoose = require("mongoose");
const { Schema } = mongoose;

// Player Schema
const playerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    position: {
      type: String,
      enum: ["Player", "Substitute", "Captain"],
      required: true,
    },
  },
  { timestamps: true }
);

const Player = mongoose.model("Player", playerSchema); // Export the model

// Team Schema
const teamSchema = new Schema(
  {
    name: { type: String, required: true, index: true },
    players: [{ type: playerSchema }], // Embed player schema directly
  },
  { timestamps: true }
);

const Team = mongoose.model("Team", teamSchema);

// Group Schema
const groupSchema = new Schema(
  {
    name: { type: String, required: true, index: true },
    teams: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team", // Reference Team model
      },
    ],
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager", // Reference Manager model
      required: true,
    },
  },
  { timestamps: true }
);

const Group = mongoose.model("Group", groupSchema);

// Manager Schema
const managerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
      index: true,
    },
    password: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // References the ClubAdmin user
      required: true,
    },
    googleId: {
      type: String,
      sparse: true, // This allows the field to be optional
    },
    expoPushToken: {
      type: String,
      sparse: true, // This allows the field to be optional
    },
    groups: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group", // Reference Group model
      },
    ],
  },
  { timestamps: true }
);

managerSchema.methods.updatePushToken = async function (token) {
  if (!token) return false;

  // Clean the token string if needed
  const cleanToken = token.replace(/^"|"$/g, "");

  // Validate the token format (replace this with your own validation logic)
  if (this.isValidPushToken(cleanToken)) {
    this.expoPushToken = cleanToken;
    await this.save();
    return true;
  }
  return false;
};

managerSchema.methods.isValidPushToken = function (token) {
  // Implement your own validation logic here
  // For example, you could check if the token starts with "ExponentPushToken["
  return token.startsWith("ExponentPushToken[");
};

const Manager = mongoose.model("Manager", managerSchema);
module.exports = { Manager, Group, Team, Player };