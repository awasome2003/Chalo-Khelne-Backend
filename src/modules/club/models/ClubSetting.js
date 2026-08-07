const mongoose = require("mongoose");

/**
 * ClubSetting — one config document per facility Club (Club OS). Tenant-scoped
 * by clubId (unique). Operating parameters, tax rate, currency and dashboard
 * accent. Upserted by clubSettingController.
 */
const clubSettingSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    name: { type: String, default: "" },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    operatingHoursStart: { type: String, default: "06:00" },
    operatingHoursEnd: { type: String, default: "22:00" },
    sportsSupported: { type: [String], default: [] },
    bookingWindowDays: { type: Number, default: 7, min: 0 },
    cancellationPolicyHours: { type: Number, default: 12, min: 0 },
    taxRatePercent: { type: Number, default: 18, min: 0 },
    currency: { type: String, default: "₹" },
    primaryColor: { type: String, enum: ["emerald", "indigo", "amber", "rose"], default: "emerald" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ClubSetting", clubSettingSchema);
