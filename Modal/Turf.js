const mongoose = require("mongoose");

const turfSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Turf name is required"],
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Turf owner is required"],
    },
    // ── Tenant key (Phase 1.1 multi-tenancy) ──
    // A turf's tenant IS its owner: a club (ClubAdmin/corporate_admin User id)
    // for club turfs, or the individual User id for independently-registered
    // turfs. Set = owner on create (controller) and by the backfill. Players
    // browsing/booking are cross-tenant (no context → see all approved turfs).
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    images: [String],
    address: {
      fullAddress: {
        type: String,
        required: [true, "Address is required"],
      },
      area: {
        type: String,
        default: "",
      },
      city: {
        type: String,
        default: "",
      },
      pincode: {
        type: String,
        default: "",
      },
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    sports: [
      {
        name: {
          type: String,
          required: true,
        },
        pricePerHour: {
          type: Number,
          default: 0,
        },
        // "indoor" or "outdoor" — drives the Indoor / Outdoor tab filter on
        // the sport-selection popup. Older sports without this field fall
        // back to "outdoor" in the UI.
        category: {
          type: String,
          enum: ["indoor", "outdoor"],
          default: "outdoor",
        },
      },
    ],
    // Physical courts a player can book a slot on (e.g. "Natural Grass
    // Field" / "Indoor Turf Court"). Used by the slot-selection screen.
    courts: [
      {
        name: { type: String, required: true },
        type: { type: String, default: "" },
      },
    ],
    assignedManagers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Manager",
      },
    ],
    clubName: {
      type: String,
      required: false,
      trim: true,
    },
    razorpayAccountId: {
      type: String,
      required: false,
    },
    facilities: {
      artificialTurf: { type: Boolean, default: false },
      multipleFields: { type: Boolean, default: false },
      floodLights: { type: Boolean, default: false },
      ledLights: { type: Boolean, default: false },
      lockerRooms: { type: Boolean, default: false },
      shower: { type: Boolean, default: false },
      restrooms: { type: Boolean, default: false },
      grandstands: { type: Boolean, default: false },
      coveredAreas: { type: Boolean, default: false },
      parking: { type: Boolean, default: false },
      foodCourt: { type: Boolean, default: false },
      coldDrinks: { type: Boolean, default: false },
      drinkingWater: { type: Boolean, default: false },
      wifi: { type: Boolean, default: false },
      loungeArea: { type: Boolean, default: false },
      surveillanceCameras: { type: Boolean, default: false },
      securityPersonnel: { type: Boolean, default: false },
      firstAidKit: { type: Boolean, default: false },
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Approval gate for the public marketplace. Club-owned turfs are
    // auto-approved on create; independently-registered turfs start false and
    // require SuperAdmin approval before appearing publicly. Existing turfs are
    // backfilled to true (scripts/backfillTurfApproval.js).
    isApproved: {
      type: Boolean,
      default: false,
    },
    // For scheduling and availability
    availableTimeSlots: [
      {
        day: {
          type: String,
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
        },
        startTime: String,
        endTime: String,
      },
    ],
    // For reviews and ratings
    ratings: {
      average: {
        type: Number,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        rating: Number,
        comment: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Create indexes for efficient queries
turfSchema.index({ "address.city": 1 });
turfSchema.index({ "address.area": 1 });
turfSchema.index({ "address.pincode": 1 });
turfSchema.index({ "sports.name": 1 });
turfSchema.index({ owner: 1 });
turfSchema.index({ isActive: 1, isApproved: 1 });
turfSchema.index({ isActive: 1, createdAt: -1 });

// Multi-tenant scoping (Phase 1.1) — SHADOW MODE. clubId = owner, set
// explicitly by the create controller + the backfill (NOT from request context,
// since a turf's tenant is its owner, which may differ from the creator).
const tenantScope = require("../utils/tenantScope");
turfSchema.plugin(tenantScope, { field: "clubId", enforce: true });

const Turf = mongoose.model("Turf", turfSchema);

module.exports = Turf;
