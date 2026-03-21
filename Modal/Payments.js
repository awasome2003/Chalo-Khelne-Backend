// models/Payment.js
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  orderId: { type: String, required: true, unique: true },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  status: {
    type: String,
    enum: [
      "created",
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ],
    default: "created",
  },
  paymentMethod: {
    type: String,
    enum: ["card", "upi", "netbanking", "wallet", "any", "online"],
    default: "any",
    required: true,
  },
  paymentId: String,
  signature: String,
  receipt: String,
  error: {
    description: String,
    code: String,
    source: String,
    timestamp: Date,
    details: mongoose.Schema.Types.Mixed,
  },
  transactionDetails: {
    bankTransactionId: String,
    bankReference: String,
    upiTransactionId: String,
    merchantTransactionId: String,
    paymentNetwork: String,
    paymentMode: String,
    gatewayResponse: mongoose.Schema.Types.Mixed,
  },
  pendingReason: String,
  processingTimeout: Date,
  verificationAttempts: { type: Number, default: 0 },
  lastVerificationTime: Date,
  cancellation: {
    reason: String,
    timestamp: Date,
    initiatedBy: String,
    method: String,
    previousStatus: String,
  },
  retry: {
    count: { type: Number, default: 0 },
    lastAttempt: Date,
    nextAttemptAllowed: Date,
  },
  paymentDate: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: Date,
});

// Add indexes for better query performance
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ status: 1, createdAt: 1 });
paymentSchema.index({ eventId: 1, status: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
