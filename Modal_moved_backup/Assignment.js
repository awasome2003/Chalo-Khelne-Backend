const mongoose = require("mongoose");

const AssignmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["Tournament", "Match"],
    required: true,
  },
  refereeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
  },
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Match",
  },
  date: {
    type: Date,
    required: function () { return this.type === "Match"; },
  },
  startTime: {
    type: String,
    required: function () { return this.type === "Match"; },
  },
  endTime: {
    type: String,
    required: function () { return this.type === "Match"; },
  },
  location: {
    type: String,
    required: function () { return this.type === "Match"; },
  },
  matches: {
    type: Number,
    default: 1,
  },
  status: {
    type: String,
    // "applied"    → umpire applied to officiate a tournament (awaiting manager action)
    // "pending"    → manager assigned umpire to a match (awaiting umpire accept/decline)
    // "accepted"   → umpire accepted the match assignment
    // "declined"   → umpire declined
    // "completed"  → match finished
    // "cancelled"  → cancelled by either side
    enum: ["applied", "pending", "accepted", "declined", "completed", "cancelled"],
    default: "pending",
  },
  notes: {
    type: String,
  },
  paymentAmount: {
    type: Number,
  },
  paymentStatus: {
    type: String,
    enum: ["pending", "paid"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the timestamp when document is updated
AssignmentSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Assignment", AssignmentSchema);
