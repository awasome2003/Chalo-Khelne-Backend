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

    sportsType: {
      type: String,
      required: true,
    },
    // Locked sport rules — auto-attached from SportRuleBook at creation
    tournamentLevel: {
      type: String,
      enum: ["district", "state", "national", "international"],
      default: "district",
    },
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
      enum: ["Singles", "Doubles", "Teams", "Teams Knockout"],
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
    // Match Format Configuration (Global tournament defaults)
    matchFormat: {
      totalSets: { type: Number, default: 5 },
      setsToWin: { type: Number, default: 3 },
      totalGames: { type: Number, default: 5 },
      gamesToWin: { type: Number, default: 3 },
      pointsToWinGame: { type: Number, default: 11 },
      marginToWin: { type: Number, default: 2 },
      deuceRule: { type: Boolean, default: true }
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
