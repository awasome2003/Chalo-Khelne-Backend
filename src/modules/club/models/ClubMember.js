const mongoose = require("mongoose");

/**
 * ClubMember — a subscribed member of a facility Club (Club OS). Tenant-scoped
 * by clubId. Lifecycle (enroll/renew/expire/upgrade/refund/block) is handled in
 * clubMemberController, which auto-posts finance income/refunds + audit.
 */
const clubMemberSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    gender: { type: String, enum: ["Male", "Female", "Other"], default: "Male" },
    dob: { type: String, default: "" },
    sports: { type: [String], default: [] },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipPackage", default: null },
    packageName: { type: String, default: "" },
    status: { type: String, enum: ["Active", "Expired", "Pending", "Blocked"], default: "Active" },
    emergencyContact: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    joiningDate: { type: String, default: "" },
    lifetimeSpending: { type: Number, default: 0 },
    totalVisits: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clubMemberSchema.index({ clubId: 1, status: 1 });

module.exports = mongoose.model("ClubMember", clubMemberSchema);
