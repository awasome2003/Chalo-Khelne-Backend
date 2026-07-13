/**
 * AgencyEvent — the anchor document of the IONIX Sports Events "Event OS".
 *
 * NOTE: named AgencyEvent (collection `agencyevents`) to avoid colliding with
 * the pre-existing small `Event` model in tournaments/ (match-schedule shape).
 *
 * Phase 0 = core event fields only. Sub-resources (tasks, staff, equipment,
 * sponsors, financials, officials) become their own eventId-referencing
 * collections in later phases — NOT embedded here.
 *
 * Tenancy: agencyId = the Agency Admin's User._id (mirrors clubId=ClubAdmin _id).
 */
const mongoose = require("mongoose");

const timelineItemSchema = new mongoose.Schema({
  time: { type: String, default: "" },
  label: { type: String, default: "" },
  details: { type: String, default: "" },
}, { _id: false });

const agencyEventSchema = new mongoose.Schema({
  // Tenant scope — which agency owns this event.
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ["Tournament", "Corporate", "School", "League", "Championship", "Open Event", "Academy Event"],
    default: "Tournament",
  },
  sports: [{ type: String }],
  venue: { type: String, default: "" },

  // Client the event is for (a club/school/corporate account the agency onboarded).
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  clientType: { type: String, enum: ["school", "corporate", "club", "none"], default: "none" },

  date: { type: String, default: "" },
  time: { type: String, default: "" },
  organizer: { type: String, default: "" },
  expectedParticipants: { type: Number, default: 0 },

  registrationType: { type: String, enum: ["Free", "Paid", "Invite Only"], default: "Free" },
  registrationFee: { type: Number, default: null },

  status: {
    type: String,
    enum: ["Draft", "Planned", "Live", "Completed", "Cancelled"],
    default: "Draft",
  },

  timeline: [timelineItemSchema],

  // Bridge to the scoring engine — an event can drive a real Tournament.
  linkedTournamentId: { type: mongoose.Schema.Types.ObjectId, ref: "Tournament", default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

agencyEventSchema.index({ agencyId: 1, status: 1 });

module.exports = mongoose.models.AgencyEvent || mongoose.model("AgencyEvent", agencyEventSchema);
