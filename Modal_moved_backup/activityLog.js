const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ActivityLogSchema = new Schema({
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Manager",
    required: true,
  },
  type: {
    type: String,
    enum: [
      "login",
      "logout",
      "booking",
      "cancel",
      "update",
      "status",
      "response",
    ],
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  responseTime: {
    type: Number, // in minutes, used for tracking response times
    default: null,
  },
  metadata: {
    type: Object, // For storing any additional information
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for faster queries on createdAt and managerId
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ managerId: 1 });
ActivityLogSchema.index({ type: 1 });

const ActivityLog = mongoose.model("ActivityLog", ActivityLogSchema);

module.exports = { ActivityLog };
