/**
 * SwissMatch — one match in a Swiss-system event.
 *
 * WHY A SEPARATE COLLECTION
 * -------------------------
 * A Swiss match is structurally a group-stage match: two players, sets, no
 * bracket progression. Reusing the group-stage `Match` model was the obvious
 * move and is the wrong one:
 *
 *   • Match.groupId is required, so every Swiss match would have to invent a
 *     fake group — and would then surface on the group-stage screens.
 *   • Six controller queries run `Match.find({ tournamentId })` with no group
 *     scoping (qualifier computation, knockout seeding, tournament-wide match
 *     lists). Swiss matches would be silently swept into all of them.
 *
 * A separate collection makes that structurally impossible: a query cannot
 * return documents from a collection it does not read. Swiss is reachable from
 * the shared finders and leaderboards through the MATCH_MODELS registry in
 * utils/matchUtils.js, which is the one intended extension point.
 *
 * All creation MUST go through MatchFactory.createSwissMatch().
 * All score reads MUST go through readMatchResult(match).
 */
const mongoose = require("mongoose");
const { addFactoryEnforcement } = require("./shared/BaseMatchFields");
const { scoringDetailFields } = require("./shared/scoringDetailFields");
const { multiSportFormatFields } = require("./shared/matchFormatFields");

const SwissMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tournament",
    required: true,
  },

  sportId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sport",
    required: true,
  },
  sportName: { type: String, default: null },

  // Category bracket this event belongs to ("Open", "Above 40"). Null = the
  // sport's single undifferentiated event. Mirrors DirectKnockoutMatch, so one
  // tournament can run several independent Swiss events side by side.
  category: { type: String, default: null },

  // Which round this match belongs to. Rounds are generated one at a time —
  // round N's pairings depend on the results of round N-1.
  swissRound: { type: Number, required: true, min: 1 },
  matchNumber: { type: Number, required: true },

  // How many rounds this event runs to, denormalised onto every match.
  //
  // It lives here rather than on the tournament because the round count is a
  // property of the EVENT, and one tournament can run several — a 40-player
  // Open needs 6 rounds while an 8-player Above-40 needs 3. Carrying it on the
  // match keeps each event self-describing without a separate config document.
  totalRounds: { type: Number, required: true, min: 1 },

  matchType: {
    type: String,
    enum: ["singles", "doubles"],
    default: "singles",
  },

  // playerId is nullable ON PURPOSE. Entrants come from bookings, and
  // guest/corporate registrations (the manager's Excel upload) carry no user
  // account — they are identified by name alone, exactly as direct knockout
  // already allows.
  player1: {
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, required: true },
    partner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      userName: { type: String, default: null },
    },
  },

  // Absent when this is a bye — an odd field leaves one player without an
  // opponent for the round.
  player2: {
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: null },
    partner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      userName: { type: String, default: null },
    },
  },

  // A bye is stored as a completed match with no opponent, so it appears in the
  // round listing and feeds standings through the same path as a played match
  // rather than needing a parallel mechanism.
  isBye: { type: Boolean, default: false },

  courtNumber: { type: String, default: null },
  matchStartTime: { type: Date, default: null },
  matchEndTime: { type: Date, default: null },

  status: {
    type: String,
    enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    default: "SCHEDULED",
  },

  currentSet: { type: Number, default: 1 },
  currentGame: { type: Number, default: 1 },
  liveScore: {
    player1Points: { type: Number, default: 0 },
    player2Points: { type: Number, default: 0 },
  },

  sets: [{
    setNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS",
    },
    winner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      playerName: { type: String, default: null },
    },
    games: [{
      gameNumber: { type: Number, required: true },
      status: {
        type: String,
        enum: ["IN_PROGRESS", "COMPLETED"],
        default: "IN_PROGRESS",
      },
      finalScore: {
        player1: { type: Number, default: 0 },
        player2: { type: Number, default: 0 },
      },
      winner: {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        playerName: { type: String, default: null },
      },
      startTime: { type: Date, default: Date.now },
      endTime: { type: Date, default: null },
    }],
  }],

  scoringType: { type: String, default: null },
  matchResult: { type: mongoose.Schema.Types.Mixed, default: null },

  // Same shape the other match models carry, so the shared scoring engines and
  // readMatchFormat behave identically here.
  matchFormat: {
    setsToWin: { type: Number, default: null, min: 1, max: 10 },
    maxSets: { type: Number, default: null },
    gamesToWin: { type: Number, default: null },
    maxGames: { type: Number, default: null },
    pointsToWinGame: { type: Number, default: null, min: 1 },
    marginToWin: { type: Number, default: null, min: 1 },
    deuceRule: { type: Boolean, default: null },
    maxPointsPerGame: { type: Number, default: null },
    serviceRule: {
      pointsPerService: { type: Number, default: 2 },
      deuceServicePoints: { type: Number, default: 1 },
    },
    ...multiSportFormatFields,
  },

  result: {
    winner: {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      playerName: { type: String, default: null },
    },
    finalScore: {
      player1Sets: { type: Number, default: 0 },
      player2Sets: { type: Number, default: 0 },
    },
    // A Swiss round can legitimately be drawn (chess, and any time-limited
    // format). Knockout cannot — there the match must produce someone to
    // advance — which is why this flag lives here and not on the bracket models.
    isDraw: { type: Boolean, default: false },
    matchDuration: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    ...scoringDetailFields,
  },

  notes: String,

  referee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
}, {
  timestamps: true,
});

// Runtime enforcement: blocks direct instantiation (must use MatchFactory).
addFactoryEnforcement(SwissMatchSchema);

// One event = (tournament, sport, category). Rounds are read a round at a time.
SwissMatchSchema.index({ tournamentId: 1, sportId: 1, category: 1, swissRound: 1 });
SwissMatchSchema.index({ tournamentId: 1, status: 1 });

const tenantScope = require("../../../../utils/tenantScope");
SwissMatchSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SwissMatch", SwissMatchSchema);
