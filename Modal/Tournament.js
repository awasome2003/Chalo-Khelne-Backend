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


const tournamentSchema = new mongoose.Schema(
  {
    title: String,
    tournamentLogo: String,
    type: {
      type: String,
      enum: ["knockout", "group stage", "knockout + group stage"],
      required: true,
    },
    // Tracks which stage of the tournament is currently active
    currentStage: {
      type: String,
      enum: [
        "registration",
        "group_stage",
        "group_completed",
        "knockout",
        "completed",
      ],
      default: "registration",
    },
    // How many players from each group advance to knockout
    qualifyPerGroup: {
      type: Number,
      default: 2,
    },
    // Draw size for standalone knockout (16, 32, 64)
    drawSize: {
      type: Number,
      enum: [16, 32, 64, null],
      default: null,
    },

    // Team knockout format ID (e.g. "singles_bo5", "doubles_3p_bo7")
    davisCupFormatId: {
      type: String,
      default: null,
    },

    sportsType: {
      type: String,
      required: true,
    },
    // Locked sport rules — auto-attached from SportRuleBook at creation
    tournamentLevel: {
      type: String,
      enum: ["district", "state", "national", "international", "unranked"],
      default: "district",
    },
    // True when level=unranked and rules are user-defined (not from ruleBook)
    isCustomRules: { type: Boolean, default: false },
    // Timestamp when rules were locked (after first match generated)
    rulesLockedAt: { type: Date, default: null },
    sportRules: {
      ruleBookId: { type: mongoose.Schema.Types.ObjectId, ref: "SportRuleBook" },
      sportName: String,
      level: String,
      format: {
        totalSets: Number,
        pointsPerSet: Number,
        gamesPerSet: Number,
        pointsPerGame: Number,
        winByMargin: Number,
        maxPointsCap: Number,
        deuceEnabled: Boolean,
        tiebreakEnabled: Boolean,
        tiebreakPoints: Number,
        decidingSetPoints: Number,
        serviceAlternate: Number,
        oversCount: Number,
        inningsCount: Number,
        halvesCount: Number,
        halvesDuration: Number,
        quartersCount: Number,
        quartersDuration: Number,
      },
      rules: {
        maxPlayersPerTeam: Number,
        minPlayersPerTeam: Number,
        substitutionsAllowed: Number,
        timeoutsPerSet: Number,
        timeoutDuration: Number,
        warmupTime: Number,
        matchDuration: Number,
        breakBetweenSets: Number,
        powerPlayOvers: Number,
        wideBallRule: Boolean,
        noBallFreeHit: Boolean,
        drsAvailable: Boolean,
        batsmenPerInnings: Number,
        letServeReplay: Boolean,
        serviceFaults: Number,
        sideChangeAfterPoints: Number,
        refereeRequired: Boolean,
        umpiresCount: Number,
        thirdUmpire: Boolean,
        lineJudges: Number,
        scorerRequired: Boolean,
      },
      equipment: {
        ballType: String,
        courtSize: String,
        netHeight: String,
        tableSize: String,
        racketSpec: String,
        boardSize: String,
      },
      isLocked: { type: Boolean, default: true },
    },
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

    // Per-stage play formats (allows different formats for group stage vs knockout)
    groupStageFormat: {
      type: String,
      enum: ["Singles", "Doubles", "Teams"],
      required: function () {
        return this.type && this.type.includes("group stage");
      },
    },
    knockoutFormat: {
      type: String,
      enum: ["Singles", "Doubles", "Teams", "Teams Knockout", "Davis Cup"],
      required: function () {
        return this.type && this.type.includes("knockout");
      },
    },

    category: [
      {
        name: { type: String, required: true },
        fee: { type: Number, required: true },
      },
    ],

    // 🔹 New field for Table Tennis set format
    setFormat: {
      type: Number,
      enum: [3, 5, 7], // Best of 3, 5, 7
      default: 3,
    },
    // Canonical Match Format — single source of truth for scoring engine
    // Derived fields (setsToWin, gamesToWin) are ALWAYS computed server-side
    matchFormat: {
      // Sets-based (TT, Badminton, Tennis, Pickleball, Volleyball)
      totalSets: { type: Number, default: 3 },
      setsToWin: { type: Number, default: 2 },       // DERIVED: ceil(totalSets/2)
      totalGames: { type: Number, default: 3 },
      gamesToWin: { type: Number, default: 2 },       // DERIVED: ceil(totalGames/2)
      pointsToWinGame: { type: Number, default: 11 },
      marginToWin: { type: Number, default: 2 },
      deuceRule: { type: Boolean, default: true },
      maxPointsCap: { type: Number, default: null },
      tiebreakEnabled: { type: Boolean, default: false },
      tiebreakPoints: { type: Number, default: null },
      decidingSetPoints: { type: Number, default: null },
      serviceAlternate: { type: Number, default: 2 },
      // Innings-based (Cricket)
      oversCount: { type: Number, default: null },
      inningsCount: { type: Number, default: null },
      // Time-based (Football, Basketball, Kabaddi)
      halvesCount: { type: Number, default: null },
      halvesDuration: { type: Number, default: null },
      quartersCount: { type: Number, default: null },
      quartersDuration: { type: Number, default: null },
      // Meta
      scoringType: { type: String, enum: ["sets", "innings", "time", "single", null], default: null },
      formatVersion: { type: Number, default: 1 },
    },

    termsAndConditions: String,
    // 🔹 New field
    turfs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Turf",
        required: true,
      },
    ],

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
