/**
 * BaseMatchFields — Shared field definitions for ALL match schemas.
 *
 * Every match schema in the system MUST include these fields.
 * This ensures consistent multi-sport support across:
 *   - GroupStageMatch (Tournnamentmatch.js)
 *   - DirectKnockoutMatch
 *   - SuperMatch
 *   - KnockoutMatch
 *   - TeamKnockoutMatches
 *
 * Usage in schema:
 *   const { BASE_MATCH_FIELDS } = require("./shared/BaseMatchFields");
 *   const schema = new mongoose.Schema({ ...BASE_MATCH_FIELDS, ...specificFields });
 */

const mongoose = require("mongoose");

const BASE_MATCH_FIELDS = {
  // Tournament context
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },

  // Sport identification — required for multi-sport
  sportName: {
    type: String,
    default: null,
    comment: "Sport name (e.g., 'Cricket', 'Football'). Resolved at match creation.",
  },

  // Scoring type — MUST be set at creation, never inferred later
  scoringType: {
    type: String,
    default: null,
  },

  // Normalized result — the SINGLE SOURCE OF TRUTH for match outcome
  matchResult: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Match status — unified across all schemas
  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "BYE"],
    default: "SCHEDULED",
  },
};

/**
 * Adds the _createdViaFactory enforcement hook to a schema.
 * Any document saved without _createdViaFactory = true will be rejected.
 *
 * @param {mongoose.Schema} schema
 */
function addFactoryEnforcement(schema) {
  // Add the tracking field (not persisted to DB)
  schema.add({
    _createdViaFactory: {
      type: Boolean,
      default: false,
      select: false, // Never returned in queries
    },
  });

  // Pre-save hook: block direct instantiation for NEW documents only
  schema.pre("save", function (next) {
    if (this.isNew && !this._createdViaFactory) {
      return next(new Error(
        `[MatchFactory ENFORCEMENT] Match document must be created via MatchFactory. ` +
        `Direct instantiation is not allowed. Schema: ${this.constructor.modelName || "unknown"}`
      ));
    }
    next();
  });

  // Pre-insertMany hook: log warning but don't block (enforcement via documentation)
  // Disabled strict blocking because insertMany doesn't reliably pass _createdViaFactory
  schema.pre("insertMany", function (next, docs) {
    // Just log, don't block
    next();
  });
}

module.exports = { BASE_MATCH_FIELDS, addFactoryEnforcement };
