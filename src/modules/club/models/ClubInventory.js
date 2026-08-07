const mongoose = require("mongoose");

/**
 * ClubInventory — a stock item in a facility Club's warehouse/POS (Club OS).
 * Tenant-scoped by clubId. Renting an item auto-posts Equipment Rental income;
 * quantity ≤ minAlertThreshold flags a low-stock alert.
 */
const CATEGORIES = ["Balls", "Nets", "Rackets", "Jerseys", "Bibs", "Cones", "Equipment", "Snacks", "Drinks"];

const clubInventorySchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, default: "Equipment" },
    quantity: { type: Number, default: 0, min: 0 },
    minAlertThreshold: { type: Number, default: 5, min: 0 },
    lastRestocked: { type: String, default: "" },
    unitPrice: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubInventorySchema.index({ clubId: 1, createdAt: 1 });

module.exports = mongoose.model("ClubInventory", clubInventorySchema);
module.exports.CATEGORIES = CATEGORIES;
