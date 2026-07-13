const mongoose = require("mongoose");

/**
 * EventFinance — a single income/expense line in an event's ledger (Event OS).
 * Agency-scoped + event-scoped, mirroring the other per-event sub-resources.
 * Double-sided: `direction` income|expense with a positive `amount`; the
 * balance sheet is derived in the controller (projected/realized/expenditure).
 */
const CATEGORIES = [
  "Sponsorship", "Registrations", "Prize Money", "Venue Rental",
  "Staff Payout", "Marketing", "Equipment", "Logistics", "Other",
];

const eventFinanceSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AgencyEvent", required: true, index: true },
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    direction: { type: String, enum: ["income", "expense"], required: true },
    category: { type: String, enum: CATEGORIES, default: "Other" },
    details: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["Paid", "Pending"], default: "Paid" },
    date: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

eventFinanceSchema.index({ eventId: 1, date: -1 });

module.exports = mongoose.model("EventFinance", eventFinanceSchema);
module.exports.CATEGORIES = CATEGORIES;
