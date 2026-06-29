/**
 * Shared scoring-detail sub-schema fields for Cricket (innings) and Carrom
 * (board) scoring. Spread into the `result` object of every match model
 * (Match, DirectKnockoutMatch, SuperMatch) so the incremental scorers can
 * persist the same shape regardless of which bracket model the match lives in.
 *
 * All fields are additive/optional — set/single sports never populate them.
 */
const mongoose = require("mongoose");

const scoringDetailFields = {
  // ── CRICKET (scoringType "innings") ──
  innings: [{
    inningsNumber: { type: Number },              // 1 or 2 (super-over uses 3/4)
    battingSide: { type: String, enum: ["player1", "player2"] },
    runs: { type: Number, default: 0 },
    wickets: { type: Number, default: 0, min: 0, max: 10 },
    oversBowled: { type: Number, default: 0 },
    ballsBowled: { type: Number, default: 0, min: 0, max: 5 },
    extras: {
      wides: { type: Number, default: 0 },
      noBalls: { type: Number, default: 0 },
      byes: { type: Number, default: 0 },
      legByes: { type: Number, default: 0 },
    },
    target: { type: Number, default: null },
    status: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "IN_PROGRESS" },
    // ── Lineups + live roles (scorer-entered names; no squad system) ──
    maxOvers: { type: Number, default: null },        // overs for this innings
    battingOrder: { type: [String], default: [] },    // ordered batsman names
    bowlingOrder: { type: [String], default: [] },    // ordered bowler names
    striker: { type: String, default: null },         // batsman on strike
    nonStriker: { type: String, default: null },      // batsman at non-striker end
    currentBowler: { type: String, default: null },   // bowler of the current over
    // deliveries may also carry { striker, bowler } (Mixed — no schema change).
    deliveries: [mongoose.Schema.Types.Mixed],
    overLog: [{
      overNumber: { type: Number },
      runs: { type: Number, default: 0 },
      wickets: { type: Number, default: 0 },
      balls: [mongoose.Schema.Types.Mixed],
      _id: false,
    }],
    fallOfWickets: [{
      wicket: { type: Number },
      runs: { type: Number },
      over: { type: Number },
      _id: false,
    }],
    _id: false,
  }],
  cricketResult: {
    marginType: { type: String, enum: ["runs", "wickets", "tie", "super_over", null], default: null },
    marginValue: { type: Number, default: null },
    isTie: { type: Boolean, default: false },
    superOver: { type: mongoose.Schema.Types.Mixed, default: null },
    chasedSuccessfully: { type: Boolean, default: false },
  },

  // ── CARROM (scoringType "board") ──
  boards: [{
    boardNumber: { type: Number },
    player1Points: { type: Number, default: 0 },
    player2Points: { type: Number, default: 0 },
    queenPocketedBy: { type: String, enum: ["player1", "player2", null], default: null },
    winner: { type: String, enum: ["player1", "player2", null], default: null },
    status: { type: String, enum: ["IN_PROGRESS", "COMPLETED"], default: "COMPLETED" },
    _id: false,
  }],
};

module.exports = { scoringDetailFields };
