const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
    },
    // Event linking — polymorphic reference
    eventType: {
      type: String,
      enum: ["Tournament", "Training", "Facility", "Club", "Other"],
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    eventName: {
      type: String,
      default: "",
    },
    vendor: {
      type: String,
      default: "",
      trim: true,
    },
    expenseDate: {
      type: Date,
      required: true,
    },
    // Payment tracking
    paymentStatus: {
      type: String,
      enum: ["Pending", "Partial", "Paid", "Failed"],
      default: "Pending",
    },
    totalPaid: {
      type: Number,
      default: 0,
    },
    receipt: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubManager",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ createdBy: 1, isDeleted: 1 });
expenseSchema.index({ eventType: 1, eventId: 1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ paymentStatus: 1 });
expenseSchema.index({ expenseDate: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
