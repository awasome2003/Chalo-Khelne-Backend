const mongoose = require("mongoose");

// ─── Match Structure / Format ───
const formatSchema = new mongoose.Schema(
  {
    // Sets-based (TT, Badminton, Pickleball, Volleyball, Tennis)
    totalSets: { type: Number, default: null },
    pointsPerSet: { type: Number, default: null },
    gamesPerSet: { type: Number, default: null },
    pointsPerGame: { type: Number, default: null },
    winByMargin: { type: Number, default: null },
    maxPointsCap: { type: Number, default: null },
    deuceEnabled: { type: Boolean, default: false },
    tiebreakEnabled: { type: Boolean, default: false },
    tiebreakPoints: { type: Number, default: null },
    decidingSetPoints: { type: Number, default: null },
    serviceAlternate: { type: Number, default: null },

    // Innings-based (Cricket)
    oversCount: { type: Number, default: null },
    inningsCount: { type: Number, default: null },

    // Halves-based (Football, Hockey, Kabaddi)
    halvesCount: { type: Number, default: null },
    halvesDuration: { type: Number, default: null },

    // Quarters-based (Basketball)
    quartersCount: { type: Number, default: null },
    quartersDuration: { type: Number, default: null },
  },
  { _id: false }
);

// ─── Scoring System ───
const scoringSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["points", "runs", "goals", "frames", "result"],
      default: "points",
    },
    winCondition: {
      type: {
        type: String,
        enum: ["best-of-sets", "most-points", "most-runs", "most-goals", "best-of-frames", "single-result"],
        default: "best-of-sets",
      },
      value: { type: Number, default: null },
      margin: { type: Number, default: null },
    },
  },
  { _id: false }
);

// ─── Tie-Breaker ───
const tieBreakerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["none", "extra_time", "penalty", "golden_point", "super_over", "armageddon", "extra_frame"],
      default: "none",
    },
    rules: { type: String, default: null },
  },
  { _id: false }
);

// ─── Participant Configuration ───
const participantConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["individual", "doubles", "team"],
      default: "individual",
    },
    playersPerSide: { type: Number, default: 1 },
    squadSize: { type: Number, default: null },
  },
  { _id: false }
);

// ─── Tournament Rules (standings calculation) ───
const tournamentRulesSchema = new mongoose.Schema(
  {
    pointsForWin: { type: Number, default: 3 },
    pointsForLoss: { type: Number, default: 0 },
    pointsForDraw: { type: Number, default: 1 },
    rankingCriteria: [{ type: String }],
  },
  { _id: false }
);

// ─── Gameplay Rules ───
const rulesSchema = new mongoose.Schema(
  {
    maxPlayersPerTeam: { type: Number, default: null },
    minPlayersPerTeam: { type: Number, default: null },
    substitutionsAllowed: { type: Number, default: null },
    timeoutsPerSet: { type: Number, default: null },
    timeoutDuration: { type: Number, default: null },
    warmupTime: { type: Number, default: null },
    matchDuration: { type: Number, default: null },
    breakBetweenSets: { type: Number, default: null },

    // Cricket-specific
    powerPlayOvers: { type: Number, default: null },
    wideBallRule: { type: Boolean, default: false },
    noBallFreeHit: { type: Boolean, default: false },
    drsAvailable: { type: Boolean, default: false },
    batsmenPerInnings: { type: Number, default: null },

    // Racquet-specific
    letServeReplay: { type: Boolean, default: false },
    serviceFaults: { type: Number, default: null },
    sideChangeAfterPoints: { type: Number, default: null },

    // Officials
    refereeRequired: { type: Boolean, default: false },
    umpiresCount: { type: Number, default: null },
    thirdUmpire: { type: Boolean, default: false },
    lineJudges: { type: Number, default: null },
    scorerRequired: { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Equipment ───
const equipmentSchema = new mongoose.Schema(
  {
    ballType: { type: String, default: null },
    courtSize: { type: String, default: null },
    netHeight: { type: String, default: null },
    tableSize: { type: String, default: null },
    racketSpec: { type: String, default: null },
    boardSize: { type: String, default: null },
  },
  { _id: false }
);

// ─── Main Schema ───
const sportRuleBookSchema = new mongoose.Schema(
  {
    sportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sport",
      required: true,
    },
    sportName: {
      type: String,
      required: true,
    },
    level: {
      type: String,
      enum: ["district", "state", "national", "international"],
      required: true,
    },
    gameStructureType: {
      type: String,
      enum: ["sets", "innings", "halves", "quarters", "frames", "single"],
      default: "sets",
    },
    format: {
      type: formatSchema,
      default: () => ({}),
    },
    scoring: {
      type: scoringSchema,
      default: () => ({}),
    },
    tieBreaker: {
      type: tieBreakerSchema,
      default: () => ({}),
    },
    participantConfig: {
      type: participantConfigSchema,
      default: () => ({}),
    },
    tournamentRules: {
      type: tournamentRulesSchema,
      default: () => ({}),
    },
    rules: {
      type: rulesSchema,
      default: () => ({}),
    },
    equipment: {
      type: equipmentSchema,
      default: () => ({}),
    },
    description: {
      type: String,
      default: "",
    },
    isDefault: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound unique index: one rule book per sport per level
sportRuleBookSchema.index({ sportId: 1, level: 1 }, { unique: true });
sportRuleBookSchema.index({ sportName: 1, level: 1 });

module.exports = mongoose.model("SportRuleBook", sportRuleBookSchema);
