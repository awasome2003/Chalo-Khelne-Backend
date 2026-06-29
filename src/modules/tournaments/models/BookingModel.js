const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
    },
    userPhone: {
      type: String,
    },
    // true when booking was created via manager's bulk upload (no user account)
    isGuestBooking: {
      type: Boolean,
      default: false,
    },
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    // ── Tenant key (Phase 1.1 multi-tenancy) ──
    // Owning club = ClubAdmin/corporate_admin User _id. Derived from the
    // booking's tournament (Tournament.clubId) via the backfill script and
    // stamped on create from the request tenant context. Scoping runs in SHADOW
    // MODE (enforce:false) until backfilled + verified.
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    tournamentName: {
      type: String,
      required: true,
    },
    tournamentType: {
      type: String,
      required: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "waived"],
      default: "pending",
    },
    paymentAmount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      default: "cash", // Default to offline/cash
      enum: ["cash", "online"], // ✅ Only two methods allowed
      lowercase: true,
    },
    cancellationReason: String,
    cancellationDate: Date,
    team: {
      name: String,
      // Legacy positions (A/B/C) — kept for backward compatibility
      positions: {
        A: String, // Captain
        B: String, // First Player
        C: String, // Second Player
      },
      captain: {
        name: String,
        id: String,
        profileImage: String,
      },
      players: [
        {
          name: String,
          id: String,
          profileImage: String,
        },
      ],
      substitutes: [
        {
          name: String,
          id: String,
          profileImage: String,
        },
      ],
      // Multi-sport roster — flexible player list for any team size
      roster: [{
        userId: String,
        name: String,
        role: { type: String, enum: ["captain", "player", "substitute"], default: "player" },
        position: String, // Sport-specific position
        profileImage: String,
      }],
      teamSize: Number, // Expected team size for this sport
    },
    // STEP 17e — `selectedCategories` field declaration removed.
    // sportSelections is the canonical shape; legacy values on existing
    // docs persist until 17g $unset.
    //
    // (sport, category) pairs the player signed up for. Each pair is a
    // separate fee entry.
    sportSelections: [{
      sportId:      { type: mongoose.Schema.Types.ObjectId, ref: "Sport", required: true },
      sportName:    { type: String },
      categoryName: { type: String },
      fee:          { type: Number, default: 0 },
    }],
    // Total across all sportSelections (plus any other charges). Set by
    // the booking controller; falls back to paymentAmount for legacy
    // bookings.
    totalFee: { type: Number, default: 0 },
    employeeId: {
      type: String,
    },
    // Sport-specific booking data (dynamic fields per sport type)
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Add index for better query performance
BookingSchema.index({ userId: 1 });
BookingSchema.index({ tournamentId: 1 });
BookingSchema.index({ status: 1 });

// Prevent double-registration for real (logged-in) users at the DB level —
// the app-level findOne check can't stop two concurrent requests. Partial
// filter so GUEST bookings (userId === null, created via manager bulk upload)
// are exempt: many null-userId guests can share one tournament without
// colliding. A racing duplicate now fails with a clean E11000 (handled as 409).
// NOTE: if the collection already contains duplicate (userId, tournamentId)
// pairs, this index will fail to build until they are de-duplicated.
BookingSchema.index(
  { userId: 1, tournamentId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);

// Tenant-aware compound index for club dashboards (bookings by club + status).
BookingSchema.index({ clubId: 1, status: 1, createdAt: -1 });

// Multi-tenant scoping (Phase 1.1) — ENFORCED (2026-06-02).
// Backfill: 1016 of 1347 bookings stamped. The remaining 331 are legacy orphans
// of 47 DELETED tournaments (verified via diagnoseOrphanBookings.js) — they have
// no clubId and are therefore invisible to club-scoped queries (no leak) while
// their owning players still see them via userId (no tenant context). Verify
// (verifyBookingTenancy.js) proved scoping correct. To revert, set enforce:false.
// NOTE: .aggregate() pipelines are NOT yet scoped by this plugin.
const tenantScope = require("../../../../utils/tenantScope");
BookingSchema.plugin(tenantScope, {
  field: "clubId",
  enforce: true,
  // Bookings are usually created by players (cross-tenant, no club context),
  // so derive the tenant from the tournament when context can't supply it.
  derive: async (doc) => {
    if (!doc.tournamentId) return null;
    const t = await mongoose.model("Tournament").findById(doc.tournamentId).select("clubId").lean();
    return t ? t.clubId : null;
  },
});

module.exports = mongoose.model("Booking", BookingSchema);
