const mongoose = require("mongoose");

/**
 * ClubFinance — a single income/expense line in a facility Club's ledger (Club OS).
 * Tenant-scoped by clubId. Bookings, memberships, rentals, tournament fees and
 * refunds auto-post here (cross-module automation from the prototype).
 */
const CATEGORIES = [
  "Court Booking", "Membership", "Tournament Fee", "Equipment Rental",
  "POS Cafe", "Staff Salary", "Maintenance", "Utility Bill", "Refund", "Other",
];

const clubFinanceSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["Income", "Expense"], required: true },
    category: { type: String, enum: CATEGORIES, default: "Other" },
    amount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, default: 0 },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, enum: ["UPI", "Card", "Cash", "NetBanking"], default: "UPI" },
    referenceId: { type: String, default: "" },
    description: { type: String, default: "" },
    sourceType: { type: String, default: "" }, // e.g. "booking" — links the automation origin
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubFinanceSchema.index({ clubId: 1, date: -1 });

module.exports = mongoose.model("ClubFinance", clubFinanceSchema);
module.exports.CATEGORIES = CATEGORIES;
