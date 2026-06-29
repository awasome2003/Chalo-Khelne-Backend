const mongoose = require("mongoose");

// A substitute proposed by a coach/trainer who will be absent. Kept separate
// from Manager (staff) on purpose. Becomes a login principal only once the
// admin accepts it (email + hashed password are set then). While `active`, the
// substitute stands in for `coachId` and sees that coach's data.
const substituteSchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, // school/org admin
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: "Manager", required: true, index: true }, // absent coach/trainer
    coachName: { type: String, default: "" }, // snapshot for display

    name: { type: String, required: true, trim: true },
    contactNumber: { type: String, default: "", trim: true },
    photo: { type: String, default: "" }, // uploaded filename (served from /uploads)

    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending", index: true },
    active: { type: Boolean, default: false }, // accepted AND not yet ended (coach away)

    // Login credentials — set only on accept.
    email: { type: String, default: "", index: true },
    password: { type: String, default: "" }, // hashed

    rejectionReason: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Multi-tenant scoping (Phase 1) ─ ENFORCED ─────────────────────────
// clubId (ref User), required since creation → existing docs already populated.
// Run scripts/verifyTenancyCoverage.js (expect 100%) before deploying. NOTE:
// auth resolves a Substitute by _id BEFORE the tenant context is set, so the
// login lookup is never scoped — only club-staff list/read queries are.
const tenantScope = require("../../../../utils/tenantScope");
substituteSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("Substitute", substituteSchema);
