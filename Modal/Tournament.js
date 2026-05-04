const mongoose = require("mongoose");

const scoreSchema = new mongoose.Schema({
  matchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TournamentMatch",
    required: true,
  },
  playerA: { type: String, required: true },
  playerB: { type: String, required: true },
  setOne: { type: [Number], required: true },
  setTwo: { type: [Number], required: true },
  setThree: { type: [Number], required: true },
  winner: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Score = mongoose.model("Score", scoreSchema);

const playerSchema = new mongoose.Schema({
  playerName: { type: String, required: true },
  position: { type: String },
  image: String, // Assuming you want to upload an image for each player
});

module.exports = playerSchema;

const teamSchema = new mongoose.Schema({
  teamName: { type: String, required: true },
  logo: String,
  players: { type: [playerSchema], default: [] },
});

module.exports = teamSchema;

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  teams: { type: [teamSchema], default: [] },
});

module.exports = groupSchema;


// Per-sport track sub-schema. Each tournament can have one or more sports,
// and each sport entry holds its own categories, format, rule book, and
// stage progression. Legacy root scalars (sportsType, matchFormat, category,
// qualifyPerGroup, drawSize, currentStage, stageConfig, groupStageFormat,
// knockoutFormat, davisCupFormatId, sportRules, type) are kept during the
// migration window — sportTrackUtils transparently falls back to them.
const sportTrackSchema = new mongoose.Schema(
  {
    sportId: { type: mongoose.Schema.Types.ObjectId, ref: "Sport", required: true },
    sportName: { type: String, default: null },     // denormalized
    sportSlug: { type: String, default: null },     // denormalized

    // Per-sport tournament type — Badminton can be "knockout + group stage"
    // while Football is "knockout".
    type: {
      type: String,
      enum: ["knockout", "group stage", "knockout + group stage"],
      default: null,
    },

    // Per-sport categories with their own fees.
    categories: [{
      name: { type: String, required: true },
      fee:  { type: Number, required: true },
    }],

    groupStageFormat: {
      type: String,
      enum: ["Singles", "Doubles", "Singles, Doubles", "Teams"],
      default: null,
    },
    knockoutFormat: {
      type: String,
      enum: ["Singles", "Doubles", "Singles, Doubles", "Teams", "Teams Knockout", "Davis Cup"],
      default: null,
    },
    davisCupFormatId: { type: String, default: null },

    qualifyPerGroup: { type: Number, default: 2 },
    // No null in enum — Mongoose treats default:null + enum:[16,32,64] as a
    // skipped-validation case for unset values, avoiding the conflict that
    // arises when null is in the enum list.
    drawSize: { type: Number, enum: [16, 32, 64], default: null },

    // Per-sport tournament level — Football=state, Cricket=national,
    // TableTennis=unranked can coexist in one tournament. Empty string
    // means unset (legacy root tournamentLevel is used as fallback at
    // edit-load and create-time rule-book attach for backward compat).
    tournamentLevel: {
      type: String,
      enum: ["district", "state", "national", "international", "unranked", ""],
      default: "",
    },

    // Mirrors root tournament.matchFormat shape exactly.
    matchFormat: {
      totalSets: { type: Number, default: 3 },
      setsToWin: { type: Number, default: 2 },
      totalGames: { type: Number, default: 3 },
      gamesToWin: { type: Number, default: 2 },
      pointsToWinGame: { type: Number, default: null },
      marginToWin: { type: Number, default: null },
      deuceRule: { type: Boolean, default: true },
      maxPointsCap: { type: Number, default: null },
      tiebreakEnabled: { type: Boolean, default: false },
      tiebreakPoints: { type: Number, default: null },
      decidingSetPoints: { type: Number, default: null },
      serviceAlternate: { type: Number, default: 2 },
      oversCount: { type: Number, default: null },
      inningsCount: { type: Number, default: null },
      halvesCount: { type: Number, default: null },
      halvesDuration: { type: Number, default: null },
      quartersCount: { type: Number, default: null },
      quartersDuration: { type: Number, default: null },
      scoringType: { type: String, enum: ["sets", "innings", "time", "single", null], default: null },
      formatVersion: { type: Number, default: 1 },
    },

    // Frozen rule-book copy for this sport. Mirrors root tournament.sportRules.
    sportRules: {
      ruleBookId: { type: mongoose.Schema.Types.ObjectId, ref: "SportRuleBook" },
      sportName: String,
      level: String,
      format: {
        totalSets: Number, pointsPerSet: Number, gamesPerSet: Number,
        pointsPerGame: Number, winByMargin: Number, maxPointsCap: Number,
        deuceEnabled: Boolean, tiebreakEnabled: Boolean, tiebreakPoints: Number,
        decidingSetPoints: Number, serviceAlternate: Number,
        oversCount: Number, inningsCount: Number,
        halvesCount: Number, halvesDuration: Number,
        quartersCount: Number, quartersDuration: Number,
      },
      rules: {
        maxPlayersPerTeam: Number, minPlayersPerTeam: Number,
        substitutionsAllowed: Number, timeoutsPerSet: Number, timeoutDuration: Number,
        warmupTime: Number, matchDuration: Number, breakBetweenSets: Number,
        powerPlayOvers: Number, wideBallRule: Boolean, noBallFreeHit: Boolean,
        drsAvailable: Boolean, batsmenPerInnings: Number, letServeReplay: Boolean,
        serviceFaults: Number, sideChangeAfterPoints: Number,
        refereeRequired: Boolean, umpiresCount: Number, thirdUmpire: Boolean,
        lineJudges: Number, scorerRequired: Boolean,
      },
      equipment: {
        ballType: String, courtSize: String, netHeight: String,
        tableSize: String, racketSpec: String, boardSize: String,
      },
      isLocked: { type: Boolean, default: true },
    },

    // Per-sport stage progression — sports advance independently.
    currentStage: {
      type: String,
      enum: ["registration", "group_stage", "group_completed", "knockout", "completed"],
      default: "registration",
    },
    stageConfig: {
      qualifierKnockout: {
        enabled:   { type: Boolean, default: false },
        completed: { type: Boolean, default: false },
      },
      mainKnockout: {
        enabled:   { type: Boolean, default: false },
        completed: { type: Boolean, default: false },
      },
      groupStage: {
        completed: { type: Boolean, default: false },
      },
      // round2Format used to be a root-level dot-path field — folded in here.
      round2Format: { type: String, default: null },
    },
  },
  { _id: true, timestamps: true }
);


const tournamentSchema = new mongoose.Schema(
  {
    title: String,
    tournamentLogo: String,

    // STEP 17e — 13 root scalar fields removed. Per-sport equivalents
    // live on sports[i] (sportTrackSchema above). Removed:
    //   type, currentStage, qualifyPerGroup, drawSize, davisCupFormatId,
    //   sportsType, sportRules, groupStageFormat, knockoutFormat,
    //   category, setFormat, matchFormat, stageConfig.
    // Mongoose strict mode silently strips writes to undeclared fields;
    // existing legacy values in DB persist (visible only via .lean()
    // queries) until the STEP 17g $unset migration removes them.
    // Tournament-level metadata that stays at root: tournamentLevel (legacy
    // mirror of sports[0].tournamentLevel for the older edit modal),
    // rulesLockedAt, dates, organizer, location, etc. isCustomRules removed —
    // it was written at create time but never consumed anywhere; derive from
    // sports.some(s => s.tournamentLevel === "unranked") if needed.

    // Locked sport rules — auto-attached from SportRuleBook at creation
    tournamentLevel: {
      type: String,
      enum: ["district", "state", "national", "international", "unranked"],
      default: "district",
    },
    // Timestamp when rules were locked (after first match generated)
    rulesLockedAt: { type: Date, default: null },

    description: String,
    selectedTime: {
      startTime: String,
      endTime: String,
    },
    startDate: String,
    endDate: String,
    organizerName: String,
    cancellationPolicy: String,
    eventLocation: [{ type: String }],
    managerId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Manager",
      },
    ],

    // Per-sport tracks. Canonical source of all per-sport config:
    // sportName, type, categories, matchFormat, sportRules,
    // groupStageFormat, knockoutFormat, davisCupFormatId, drawSize,
    // qualifyPerGroup, currentStage, stageConfig.
    //
    // STEP 17f — required: true with min-1 validator. The 16b boundary
    // validator already enforces this on incoming writes; the schema
    // flip is belt-and-suspenders for direct ORM inserts (seed scripts,
    // shell, etc.). Audit confirms 0 tournaments with empty sports[].
    sports: {
      type: [sportTrackSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1,
        message: "Tournament.sports must contain at least one sport track.",
      },
    },

    // Registration deadline — last date/time for players to register
    registrationDeadline: { type: Date, default: null },

    termsAndConditions: String,
    // 🔹 New field
    turfs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Turf",
        required: true,
      },
    ],

    // Private/Public visibility toggle
    isPrivate: {
      type: Boolean,
      default: false,
    },

    // Auto-generated or custom client ID for private tournaments
    clientId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // 🔹 New field for Corporate Employee Whitelist
    whitelist: [
      {
        employeeId: { type: String },
        name: { type: String },
        mobile: { type: String },
      },
    ],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);


module.exports = mongoose.model("Tournament", tournamentSchema);
