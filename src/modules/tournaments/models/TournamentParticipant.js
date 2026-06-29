"use strict";
/**
 * TournamentParticipant (Phase 5) — extracted from Tournament.whitelist[].
 *
 * Corporate events embed every eligible employee in the Tournament document.
 * At 10k+ employees that single doc passes 1MB and approaches the 16MB ceiling,
 * and every tournament read drags the whole list. The whitelist now lives in its
 * own collection, referenced by tournamentId + tenant-scoped by clubId.
 */
const mongoose = require("mongoose");

const tournamentParticipantSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true, index: true },
    employeeId: { type: String, default: "" },
    name: { type: String, default: "" },
    mobile: { type: String, default: "" },
    // Tenant key — the owning ClubAdmin/corporate_admin User _id (= Tournament.clubId).
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  },
  { timestamps: true }
);

// Hot path: a tournament's whitelist; uniqueness guards re-migration (idempotent).
tournamentParticipantSchema.index({ tournamentId: 1, employeeId: 1 }, { unique: true, sparse: true });
tournamentParticipantSchema.index({ tournamentId: 1, mobile: 1 });

const tenantScope = require("../../../../utils/tenantScope");
tournamentParticipantSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports =
  mongoose.models.TournamentParticipant ||
  mongoose.model("TournamentParticipant", tournamentParticipantSchema);
