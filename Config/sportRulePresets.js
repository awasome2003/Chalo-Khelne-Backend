/**
 * Sport Rule Book Presets — Production-Ready
 *
 * 15 sports x 4 levels = 60 rule books.
 * Each level is realistically differentiated (district → international).
 * All fields are executable by the scoring engine — no decorative nulls.
 *
 * Structure per preset:
 *   gameStructureType, format, scoring, tieBreaker,
 *   participantConfig, tournamentRules, rules, equipment, description
 */

const LEVELS = ["district", "state", "national", "international"];

// ═══════════════════════════════════════════
//  TABLE TENNIS
// ═══════════════════════════════════════════
const tableTennis = {
  district: {
    description: "District TT — Best of 5, 11 pts, basic officiating",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 11, winByMargin: 2,
      deuceEnabled: true, serviceAlternate: 2,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 1, timeoutDuration: 60, warmupTime: 2, breakBetweenSets: 60,
      letServeReplay: true, serviceFaults: 0,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "40mm plastic (3-star)", tableSize: "Standard 9ft x 5ft",
      netHeight: "15.25cm", racketSpec: "ITTF approved rubber",
    },
  },
  state: {
    description: "State TT — Best of 5, 11 pts, referee mandatory",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 11, winByMargin: 2,
      deuceEnabled: true, serviceAlternate: 2,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 1, timeoutDuration: 60, warmupTime: 2, breakBetweenSets: 60,
      letServeReplay: true, serviceFaults: 0,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "40mm plastic (3-star ITTF)", tableSize: "Standard 9ft x 5ft",
      netHeight: "15.25cm", racketSpec: "ITTF approved rubber",
    },
  },
  national: {
    description: "National TT — Best of 7, 11 pts, strict officiating",
    gameStructureType: "sets",
    format: {
      totalSets: 7, pointsPerSet: 11, winByMargin: 2,
      deuceEnabled: true, serviceAlternate: 2,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 4, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 1, timeoutDuration: 60, warmupTime: 2, breakBetweenSets: 60,
      letServeReplay: true, serviceFaults: 0,
      refereeRequired: true, umpiresCount: 1, lineJudges: 0, scorerRequired: true,
    },
    equipment: {
      ballType: "40mm plastic (3-star ITTF)", tableSize: "Standard 9ft x 5ft",
      netHeight: "15.25cm", racketSpec: "ITTF approved rubber",
    },
  },
  international: {
    description: "International TT — Best of 7, ITTF standard, full panel",
    gameStructureType: "sets",
    format: {
      totalSets: 7, pointsPerSet: 11, winByMargin: 2,
      deuceEnabled: true, serviceAlternate: 2,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 4, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio", "ITTF-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 1, timeoutDuration: 60, warmupTime: 2, breakBetweenSets: 60,
      letServeReplay: true, serviceFaults: 0,
      refereeRequired: true, umpiresCount: 2, lineJudges: 0, scorerRequired: true,
    },
    equipment: {
      ballType: "40mm plastic (3-star ITTF approved)", tableSize: "Standard 9ft x 5ft ITTF certified",
      netHeight: "15.25cm", racketSpec: "ITTF approved rubber, max 4mm thickness",
    },
  },
};

// ═══════════════════════════════════════════
//  BADMINTON
// ═══════════════════════════════════════════
const badminton = {
  district: {
    description: "District Badminton — Best of 3, 21 pts, cap 30",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 21, winByMargin: 2, maxPointsCap: 30,
      deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "At 29-29, next point wins (cap 30)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 120,
      letServeReplay: false, serviceFaults: 1,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Feather shuttlecock",
      courtSize: "Singles: 13.4m x 5.18m, Doubles: 13.4m x 6.1m",
      netHeight: "1.55m at edges, 1.524m at center",
      racketSpec: "Standard badminton racket",
    },
  },
  state: {
    description: "State Badminton — Best of 3, 21 pts, interval at 11",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 21, winByMargin: 2, maxPointsCap: 30,
      deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "At 29-29, next point wins (cap 30)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 120,
      letServeReplay: false, serviceFaults: 1,
      refereeRequired: true, umpiresCount: 1, lineJudges: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "BWF approved feather shuttlecock",
      courtSize: "Singles: 13.4m x 5.18m, Doubles: 13.4m x 6.1m",
      netHeight: "1.55m at edges, 1.524m at center",
      racketSpec: "BWF approved racket",
    },
  },
  national: {
    description: "National Badminton — Best of 3, BWF standard, line judges",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 21, winByMargin: 2, maxPointsCap: 30,
      deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "At 29-29, next point wins (cap 30)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 120,
      letServeReplay: false, serviceFaults: 1,
      refereeRequired: true, umpiresCount: 1, lineJudges: 4, scorerRequired: true,
    },
    equipment: {
      ballType: "BWF approved feather shuttlecock",
      courtSize: "Singles: 13.4m x 5.18m, Doubles: 13.4m x 6.1m",
      netHeight: "1.55m at edges, 1.524m at center",
      racketSpec: "BWF approved racket",
    },
  },
  international: {
    description: "International Badminton — BWF standard, instant review, full panel",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 21, winByMargin: 2, maxPointsCap: 30,
      deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "At 29-29, next point wins (cap 30)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio", "BWF-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 120,
      letServeReplay: false, serviceFaults: 1,
      refereeRequired: true, umpiresCount: 1, lineJudges: 6, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "BWF approved feather shuttlecock (speed tested)",
      courtSize: "Singles: 13.4m x 5.18m, Doubles: 13.4m x 6.1m",
      netHeight: "1.55m at edges, 1.524m at center",
      racketSpec: "BWF approved racket",
    },
  },
};

// ═══════════════════════════════════════════
//  PICKLEBALL
// ═══════════════════════════════════════════
const pickleball = {
  district: {
    description: "District Pickleball — Best of 3, 11 pts, side-out scoring",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 11, winByMargin: 2, deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 1, timeoutDuration: 60, warmupTime: 5, breakBetweenSets: 120,
      sideChangeAfterPoints: 6,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Outdoor polymer ball (40 holes)",
      courtSize: "20ft x 44ft", netHeight: "36in at sidelines, 34in center",
      racketSpec: "Paddle max 24in (length + width)",
    },
  },
  state: {
    description: "State Pickleball — Best of 3, 11 pts, stricter officiating",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 11, winByMargin: 2, deuceEnabled: true,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 2, timeoutDuration: 60, warmupTime: 5, breakBetweenSets: 120,
      sideChangeAfterPoints: 6,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "USAPA approved ball",
      courtSize: "20ft x 44ft", netHeight: "36in at sidelines, 34in center",
      racketSpec: "USAPA approved paddle",
    },
  },
  national: {
    description: "National Pickleball — Best of 3, deciding set 15 pts",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 11, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 2, timeoutDuration: 60, warmupTime: 5, breakBetweenSets: 120,
      sideChangeAfterPoints: 8,
      refereeRequired: true, umpiresCount: 1, lineJudges: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "USAPA approved ball",
      courtSize: "20ft x 44ft", netHeight: "36in at sidelines, 34in center",
      racketSpec: "USAPA approved paddle",
    },
  },
  international: {
    description: "International Pickleball — Best of 5, IFP standard",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 11, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      timeoutsPerSet: 2, timeoutDuration: 60, warmupTime: 5, breakBetweenSets: 120,
      sideChangeAfterPoints: 8,
      refereeRequired: true, umpiresCount: 2, lineJudges: 4, scorerRequired: true,
    },
    equipment: {
      ballType: "IFP approved ball",
      courtSize: "20ft x 44ft", netHeight: "36in at sidelines, 34in center",
      racketSpec: "IFP approved paddle",
    },
  },
};

// ═══════════════════════════════════════════
//  TENNIS
// ═══════════════════════════════════════════
const tennis = {
  district: {
    description: "District Tennis — Best of 3 sets, tiebreak at 6-6",
    gameStructureType: "sets",
    format: {
      totalSets: 3, gamesPerSet: 6, pointsPerGame: 4, winByMargin: 2,
      deuceEnabled: true, tiebreakEnabled: true, tiebreakPoints: 7,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "Tiebreak at 6-6 in each set, first to 7 (win by 2)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "game-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1,
      warmupTime: 5, breakBetweenSets: 120,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "ITF approved tennis ball",
      courtSize: "Singles: 23.77m x 8.23m, Doubles: 23.77m x 10.97m",
      netHeight: "0.914m at center",
    },
  },
  state: {
    description: "State Tennis — Best of 3 sets, chair umpire mandatory",
    gameStructureType: "sets",
    format: {
      totalSets: 3, gamesPerSet: 6, pointsPerGame: 4, winByMargin: 2,
      deuceEnabled: true, tiebreakEnabled: true, tiebreakPoints: 7,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "Tiebreak at 6-6, first to 7 (win by 2). Match tiebreak 10-point in deciding set" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "game-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1,
      warmupTime: 5, breakBetweenSets: 120,
      refereeRequired: true, umpiresCount: 1, lineJudges: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "ITF approved tennis ball",
      courtSize: "Singles: 23.77m x 8.23m, Doubles: 23.77m x 10.97m",
      netHeight: "0.914m at center",
    },
  },
  national: {
    description: "National Tennis — Best of 3, Hawk-Eye available",
    gameStructureType: "sets",
    format: {
      totalSets: 3, gamesPerSet: 6, pointsPerGame: 4, winByMargin: 2,
      deuceEnabled: true, tiebreakEnabled: true, tiebreakPoints: 7,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "Tiebreak at 6-6, first to 7 (win by 2). Super tiebreak in deciding set (first to 10)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "game-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1,
      warmupTime: 5, breakBetweenSets: 120,
      refereeRequired: true, umpiresCount: 1, lineJudges: 6, scorerRequired: true,
    },
    equipment: {
      ballType: "ITF approved tennis ball",
      courtSize: "Singles: 23.77m x 8.23m, Doubles: 23.77m x 10.97m",
      netHeight: "0.914m at center",
    },
  },
  international: {
    description: "International Tennis — Best of 5 (Grand Slam), full officiating",
    gameStructureType: "sets",
    format: {
      totalSets: 5, gamesPerSet: 6, pointsPerGame: 4, winByMargin: 2,
      deuceEnabled: true, tiebreakEnabled: true, tiebreakPoints: 7,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "golden_point", rules: "Tiebreak at 6-6 all sets including deciding set (first to 10, win by 2)" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "set-ratio", "game-ratio", "ATP/WTA-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1,
      warmupTime: 5, breakBetweenSets: 120,
      refereeRequired: true, umpiresCount: 1, lineJudges: 9, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "ITF approved Grand Slam ball",
      courtSize: "Singles: 23.77m x 8.23m, Doubles: 23.77m x 10.97m",
      netHeight: "0.914m at center",
    },
  },
};

// ═══════════════════════════════════════════
//  CRICKET
// ═══════════════════════════════════════════
const cricket = {
  district: {
    description: "District Cricket — 15 overs, 2 innings, basic rules",
    gameStructureType: "innings",
    format: { oversCount: 15, inningsCount: 2 },
    scoring: {
      type: "runs",
      winCondition: { type: "most-runs", value: null, margin: null },
    },
    tieBreaker: { type: "super_over", rules: "1 super over per side, 6 balls each. Higher runs wins. Repeat if tied." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 13 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "net-run-rate", "head-to-head", "runs-scored"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 8, substitutionsAllowed: 1,
      warmupTime: 10, matchDuration: 180,
      powerPlayOvers: 3, wideBallRule: true, noBallFreeHit: true,
      drsAvailable: false, batsmenPerInnings: 11,
      refereeRequired: false, umpiresCount: 1, thirdUmpire: false, scorerRequired: true,
    },
    equipment: {
      ballType: "Leather ball (standard)",
      courtSize: "Standard cricket ground",
    },
  },
  state: {
    description: "State Cricket — T20 (20 overs), DRS not available",
    gameStructureType: "innings",
    format: { oversCount: 20, inningsCount: 2 },
    scoring: {
      type: "runs",
      winCondition: { type: "most-runs", value: null, margin: null },
    },
    tieBreaker: { type: "super_over", rules: "1 super over per side. If still tied, boundary count-back." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 15 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "net-run-rate", "head-to-head", "runs-scored"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 9, substitutionsAllowed: 1,
      warmupTime: 15, matchDuration: 240,
      powerPlayOvers: 6, wideBallRule: true, noBallFreeHit: true,
      drsAvailable: false, batsmenPerInnings: 11,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: false, scorerRequired: true,
    },
    equipment: {
      ballType: "SG or equivalent leather ball",
      courtSize: "Standard cricket ground, minimum 60m boundary",
    },
  },
  national: {
    description: "National Cricket — T20 (20 overs), DRS available",
    gameStructureType: "innings",
    format: { oversCount: 20, inningsCount: 2 },
    scoring: {
      type: "runs",
      winCondition: { type: "most-runs", value: null, margin: null },
    },
    tieBreaker: { type: "super_over", rules: "1 super over per side. If still tied, repeated super over." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 15 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "net-run-rate", "head-to-head", "runs-scored"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 11, substitutionsAllowed: 1,
      warmupTime: 15, matchDuration: 240,
      powerPlayOvers: 6, wideBallRule: true, noBallFreeHit: true,
      drsAvailable: true, batsmenPerInnings: 11,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "SG Test / Kookaburra",
      courtSize: "Standard cricket ground, minimum 65m boundary",
    },
  },
  international: {
    description: "International Cricket — ICC T20 rules, full DRS, Snickometer",
    gameStructureType: "innings",
    format: { oversCount: 20, inningsCount: 2 },
    scoring: {
      type: "runs",
      winCondition: { type: "most-runs", value: null, margin: null },
    },
    tieBreaker: { type: "super_over", rules: "ICC super over rules. If tied again, repeated super overs until result." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 15 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "net-run-rate", "head-to-head", "runs-scored", "ICC-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 11, substitutionsAllowed: 1,
      warmupTime: 20, matchDuration: 240,
      powerPlayOvers: 6, wideBallRule: true, noBallFreeHit: true,
      drsAvailable: true, batsmenPerInnings: 11,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "Kookaburra / Dukes ICC approved",
      courtSize: "ICC standard ground, 65-82m boundary",
    },
  },
};

// ═══════════════════════════════════════════
//  FOOTBALL
// ═══════════════════════════════════════════
const football = {
  district: {
    description: "District Football — 2 halves x 30 min, no extra time",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 30 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "Straight to penalty shootout (5 kicks per side)" },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 16 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 3,
      warmupTime: 10, matchDuration: 60,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Size 5 football",
      courtSize: "90-100m x 45-60m",
    },
  },
  state: {
    description: "State Football — 2 halves x 40 min, penalty shootout",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 40 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "5 penalties per side. Sudden death if tied after 5." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 18 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 3,
      warmupTime: 15, matchDuration: 80,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Size 5 football (FIFA quality)",
      courtSize: "100-110m x 64-75m",
    },
  },
  national: {
    description: "National Football — 2 x 45 min, extra time + penalties",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 45 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 15 min extra time. If still tied, penalty shootout (5 kicks, then sudden death)." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 20 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head", "fair-play"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 15, matchDuration: 90,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "FIFA Quality Pro ball",
      courtSize: "100-110m x 64-75m",
    },
  },
  international: {
    description: "International Football — FIFA standard, VAR, 2 x 45 min",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 45 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 15 min extra time with VAR. If still tied, penalty shootout (5 kicks, then sudden death)." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 23 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head", "fair-play", "FIFA-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 15, matchDuration: 90,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "FIFA Quality Pro match ball",
      courtSize: "105m x 68m (FIFA standard)",
    },
  },
};

// ═══════════════════════════════════════════
//  BASKETBALL
// ═══════════════════════════════════════════
const basketball = {
  district: {
    description: "District Basketball — 4 x 8 min quarters",
    gameStructureType: "quarters",
    format: { quartersCount: 4, quartersDuration: 8 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "1 overtime period of 5 min. Repeat until winner." },
    participantConfig: { type: "team", playersPerSide: 5, squadSize: 10 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 1, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "point-difference", "points-scored"],
    },
    rules: {
      maxPlayersPerTeam: 5, minPlayersPerTeam: 5, substitutionsAllowed: 7,
      timeoutsPerSet: 2, timeoutDuration: 60, warmupTime: 10, matchDuration: 32,
      refereeRequired: false, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "Size 7 basketball",
      courtSize: "28m x 15m",
    },
  },
  state: {
    description: "State Basketball — 4 x 10 min quarters",
    gameStructureType: "quarters",
    format: { quartersCount: 4, quartersDuration: 10 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "5 min overtime periods until winner decided." },
    participantConfig: { type: "team", playersPerSide: 5, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 1, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "point-difference", "points-scored"],
    },
    rules: {
      maxPlayersPerTeam: 5, minPlayersPerTeam: 5, substitutionsAllowed: 7,
      timeoutsPerSet: 2, timeoutDuration: 60, warmupTime: 10, matchDuration: 40,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "Size 7 basketball (FIBA quality)",
      courtSize: "28m x 15m",
    },
  },
  national: {
    description: "National Basketball — 4 x 10 min, FIBA rules",
    gameStructureType: "quarters",
    format: { quartersCount: 4, quartersDuration: 10 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "5 min overtime. Unlimited OT periods until result." },
    participantConfig: { type: "team", playersPerSide: 5, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 1, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "point-difference", "points-scored"],
    },
    rules: {
      maxPlayersPerTeam: 5, minPlayersPerTeam: 5, substitutionsAllowed: 7,
      timeoutsPerSet: 3, timeoutDuration: 60, warmupTime: 15, matchDuration: 40,
      refereeRequired: true, umpiresCount: 3, scorerRequired: true,
    },
    equipment: {
      ballType: "FIBA approved ball",
      courtSize: "28m x 15m (FIBA standard)",
    },
  },
  international: {
    description: "International Basketball — 4 x 12 min (NBA) or 10 min (FIBA), instant replay",
    gameStructureType: "quarters",
    format: { quartersCount: 4, quartersDuration: 12 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "5 min overtime periods with instant replay. Unlimited until result." },
    participantConfig: { type: "team", playersPerSide: 5, squadSize: 15 },
    tournamentRules: {
      pointsForWin: 2, pointsForLoss: 1, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "point-difference", "points-scored", "FIBA-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 5, minPlayersPerTeam: 5, substitutionsAllowed: 7,
      timeoutsPerSet: 4, timeoutDuration: 60, warmupTime: 15, matchDuration: 48,
      refereeRequired: true, umpiresCount: 3, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "FIBA/NBA approved match ball",
      courtSize: "28m x 15m (FIBA) / 28.65m x 15.24m (NBA)",
    },
  },
};

// ═══════════════════════════════════════════
//  VOLLEYBALL
// ═══════════════════════════════════════════
const volleyball = {
  district: {
    description: "District Volleyball — Best of 3, 25 pts, deciding 15",
    gameStructureType: "sets",
    format: {
      totalSets: 3, pointsPerSet: 25, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 2, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: 6, squadSize: 10 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "set-ratio", "point-ratio", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 6, minPlayersPerTeam: 6, substitutionsAllowed: 6,
      timeoutsPerSet: 2, warmupTime: 10,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Standard volleyball",
      courtSize: "18m x 9m", netHeight: "Men: 2.43m, Women: 2.24m",
    },
  },
  state: {
    description: "State Volleyball — Best of 5, 25 pts, deciding 15",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 25, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: 6, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "set-ratio", "point-ratio", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 6, minPlayersPerTeam: 6, substitutionsAllowed: 6,
      timeoutsPerSet: 2, warmupTime: 10,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "FIVB quality volleyball",
      courtSize: "18m x 9m", netHeight: "Men: 2.43m, Women: 2.24m",
    },
  },
  national: {
    description: "National Volleyball — Best of 5, FIVB rules",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 25, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: 6, squadSize: 14 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "set-ratio", "point-ratio", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 6, minPlayersPerTeam: 6, substitutionsAllowed: 6,
      timeoutsPerSet: 2, warmupTime: 10,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "FIVB approved volleyball",
      courtSize: "18m x 9m", netHeight: "Men: 2.43m, Women: 2.24m",
    },
  },
  international: {
    description: "International Volleyball — Best of 5, FIVB standard, video challenge",
    gameStructureType: "sets",
    format: {
      totalSets: 5, pointsPerSet: 25, winByMargin: 2, deuceEnabled: true,
      decidingSetPoints: 15,
    },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-sets", value: 3, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: 6, squadSize: 14 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "set-ratio", "point-ratio", "head-to-head", "FIVB-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 6, minPlayersPerTeam: 6, substitutionsAllowed: 6,
      timeoutsPerSet: 2, warmupTime: 10,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "FIVB approved match ball",
      courtSize: "18m x 9m", netHeight: "Men: 2.43m, Women: 2.24m",
    },
  },
};

// ═══════════════════════════════════════════
//  HOCKEY
// ═══════════════════════════════════════════
const hockey = {
  district: {
    description: "District Hockey — 2 x 25 min halves",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 25 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "Penalty shootout (5 one-on-one penalty strokes)" },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 16 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 10, matchDuration: 50,
      refereeRequired: false, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "Standard hockey ball",
      courtSize: "91.4m x 55m",
    },
  },
  state: {
    description: "State Hockey — 2 x 30 min halves",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 30 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "Penalty shootout (5 strokes). Sudden death after 5." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 18 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 10, matchDuration: 60,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "FIH quality hockey ball",
      courtSize: "91.4m x 55m",
    },
  },
  national: {
    description: "National Hockey — 4 x 15 min quarters (FIH format)",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 35 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "Penalty shootout (5 strokes, 8-second one-on-one). Sudden death if tied." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 18 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head", "fair-play"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 10, matchDuration: 70,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "FIH approved hockey ball",
      courtSize: "91.4m x 55m",
    },
  },
  international: {
    description: "International Hockey — FIH standard, video referral",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 35 },
    scoring: {
      type: "goals",
      winCondition: { type: "most-goals", value: null, margin: null },
    },
    tieBreaker: { type: "penalty", rules: "FIH shootout: 5 x 8-second one-on-one. Video referral available. Sudden death if tied." },
    participantConfig: { type: "team", playersPerSide: 11, squadSize: 18 },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "goal-difference", "goals-scored", "head-to-head", "fair-play", "FIH-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 11, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 10, matchDuration: 70,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      ballType: "FIH approved match ball",
      courtSize: "91.4m x 55m (FIH certified)",
    },
  },
};

// ═══════════════════════════════════════════
//  KABADDI
// ═══════════════════════════════════════════
const kabaddi = {
  district: {
    description: "District Kabaddi — 2 x 15 min halves",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 15 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 5 min extra time halves. If still tied, golden raid (sudden death)." },
    participantConfig: { type: "team", playersPerSide: 7, squadSize: 10 },
    tournamentRules: {
      pointsForWin: 5, pointsForLoss: 0, pointsForDraw: 3,
      rankingCriteria: ["points", "score-difference", "head-to-head", "total-scored"],
    },
    rules: {
      maxPlayersPerTeam: 7, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 5, matchDuration: 30,
      refereeRequired: false, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      courtSize: "13m x 10m (men), 12m x 8m (women)",
    },
  },
  state: {
    description: "State Kabaddi — 2 x 20 min halves, PKL format",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 20 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 5 min extra time. If tied, golden raid." },
    participantConfig: { type: "team", playersPerSide: 7, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 5, pointsForLoss: 0, pointsForDraw: 3,
      rankingCriteria: ["points", "score-difference", "head-to-head", "total-scored"],
    },
    rules: {
      maxPlayersPerTeam: 7, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 5, matchDuration: 40,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      courtSize: "13m x 10m (men), 12m x 8m (women)",
    },
  },
  national: {
    description: "National Kabaddi — 2 x 20 min, full officiating",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 20 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 7 min extra time. If still tied, golden raid with toss advantage." },
    participantConfig: { type: "team", playersPerSide: 7, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 5, pointsForLoss: 0, pointsForDraw: 3,
      rankingCriteria: ["points", "score-difference", "head-to-head", "total-scored"],
    },
    rules: {
      maxPlayersPerTeam: 7, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 5, matchDuration: 40,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      courtSize: "13m x 10m (men), 12m x 8m (women)",
    },
  },
  international: {
    description: "International Kabaddi — IKF/PKL rules, video review",
    gameStructureType: "halves",
    format: { halvesCount: 2, halvesDuration: 20 },
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "extra_time", rules: "2 x 7 min extra time with video review. Golden raid if still tied." },
    participantConfig: { type: "team", playersPerSide: 7, squadSize: 12 },
    tournamentRules: {
      pointsForWin: 5, pointsForLoss: 0, pointsForDraw: 3,
      rankingCriteria: ["points", "score-difference", "head-to-head", "total-scored", "IKF-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 7, minPlayersPerTeam: 7, substitutionsAllowed: 5,
      warmupTime: 5, matchDuration: 40,
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {
      courtSize: "13m x 10m (men), 12m x 8m (women)",
    },
  },
};

// ═══════════════════════════════════════════
//  CHESS
// ═══════════════════════════════════════════
const chess = {
  district: {
    description: "District Chess — Rapid 15+10, single game",
    gameStructureType: "single",
    format: { totalSets: 1 },
    scoring: {
      type: "result",
      winCondition: { type: "single-result", value: 1, margin: null },
    },
    tieBreaker: { type: "armageddon", rules: "Blitz tiebreak: 5 min vs 4 min. Black gets draw odds." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0.5,
      rankingCriteria: ["points", "buchholz", "sonneborn-berger", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1,
      matchDuration: 30, warmupTime: 0,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "Standard tournament board",
      ballType: "Staunton pieces",
    },
  },
  state: {
    description: "State Chess — Rapid 15+10, arbiter required",
    gameStructureType: "single",
    format: { totalSets: 1 },
    scoring: {
      type: "result",
      winCondition: { type: "single-result", value: 1, margin: null },
    },
    tieBreaker: { type: "armageddon", rules: "Two rapid games (10+5). If tied, armageddon." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0.5,
      rankingCriteria: ["points", "buchholz", "sonneborn-berger", "head-to-head"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1,
      matchDuration: 30, warmupTime: 0,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "FIDE standard tournament board",
      ballType: "Staunton pieces, weighted",
    },
  },
  national: {
    description: "National Chess — Classical 90+30, FIDE rated",
    gameStructureType: "single",
    format: { totalSets: 1 },
    scoring: {
      type: "result",
      winCondition: { type: "single-result", value: 1, margin: null },
    },
    tieBreaker: { type: "armageddon", rules: "Two rapid games (15+10). If tied, two blitz (5+3). If still tied, armageddon." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0.5,
      rankingCriteria: ["points", "buchholz", "sonneborn-berger", "head-to-head", "FIDE-rating"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1,
      matchDuration: 180, warmupTime: 0,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "FIDE certified board",
      ballType: "FIDE approved Staunton pieces",
    },
  },
  international: {
    description: "International Chess — FIDE Classical 90+30+increment, DGT boards",
    gameStructureType: "single",
    format: { totalSets: 1 },
    scoring: {
      type: "result",
      winCondition: { type: "single-result", value: 1, margin: null },
    },
    tieBreaker: { type: "armageddon", rules: "FIDE tiebreak protocol: 4 rapid (25+10), then 2 blitz (5+3), then armageddon." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0.5,
      rankingCriteria: ["points", "buchholz", "sonneborn-berger", "head-to-head", "FIDE-rating"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1,
      matchDuration: 240, warmupTime: 0,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      boardSize: "FIDE certified board with DGT",
      ballType: "FIDE approved Staunton pieces, weighted",
    },
  },
};

// ═══════════════════════════════════════════
//  CARROM
// ═══════════════════════════════════════════
const carrom = {
  district: {
    description: "District Carrom — Best of 3 boards, 25 pts",
    gameStructureType: "frames",
    format: { totalSets: 3, pointsPerSet: 25, winByMargin: 1 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 2, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "One extra board. Higher points wins." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "board-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 60,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "29 inches (standard)",
      ballType: "Wooden coins + striker",
    },
  },
  state: {
    description: "State Carrom — Best of 3 boards, ICF rules",
    gameStructureType: "frames",
    format: { totalSets: 3, pointsPerSet: 25, winByMargin: 1 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 2, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "One extra board with ICF tiebreak procedure." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "board-difference", "point-difference"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 2, breakBetweenSets: 60,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "29 inches (ICF standard)",
      ballType: "ICF approved coins + striker",
    },
  },
  national: {
    description: "National Carrom — Best of 5 boards",
    gameStructureType: "frames",
    format: { totalSets: 5, pointsPerSet: 25, winByMargin: 1 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 3, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "One extra board. If still tied, coin toss for first strike." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "board-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 3, breakBetweenSets: 60,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      boardSize: "29 inches (ICF certified)",
      ballType: "ICF approved coins + striker",
    },
  },
  international: {
    description: "International Carrom — Best of 5, ICF championship rules",
    gameStructureType: "frames",
    format: { totalSets: 5, pointsPerSet: 29, winByMargin: 1 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 3, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "ICF championship tiebreak: extra board with time limit." },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "board-ratio", "point-ratio"],
    },
    rules: {
      maxPlayersPerTeam: 2, minPlayersPerTeam: 1, substitutionsAllowed: 0,
      warmupTime: 3, breakBetweenSets: 60,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      boardSize: "29 inches (ICF certified)",
      ballType: "ICF championship approved coins + striker",
    },
  },
};

// ═══════════════════════════════════════════
//  SNOOKER
// ═══════════════════════════════════════════
const snooker = {
  district: {
    description: "District Snooker — Best of 3 frames",
    gameStructureType: "frames",
    format: { totalSets: 3 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 2, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "Re-spotted black ball" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "frame-difference", "centuries"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, warmupTime: 3,
      refereeRequired: false, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Standard snooker balls (22)",
      tableSize: "12ft x 6ft",
    },
  },
  state: {
    description: "State Snooker — Best of 5 frames",
    gameStructureType: "frames",
    format: { totalSets: 5 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 3, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "Re-spotted black ball" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "frame-difference", "centuries"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, warmupTime: 3,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "Standard snooker balls (22)",
      tableSize: "12ft x 6ft",
    },
  },
  national: {
    description: "National Snooker — Best of 7 frames",
    gameStructureType: "frames",
    format: { totalSets: 7 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 4, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "Re-spotted black ball" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "frame-ratio", "centuries", "highest-break"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, warmupTime: 5,
      refereeRequired: true, umpiresCount: 1, scorerRequired: true,
    },
    equipment: {
      ballType: "WSF approved snooker balls",
      tableSize: "12ft x 6ft (tournament spec)",
    },
  },
  international: {
    description: "International Snooker — Best of 9 frames, WSF standard",
    gameStructureType: "frames",
    format: { totalSets: 9 },
    scoring: {
      type: "points",
      winCondition: { type: "best-of-frames", value: 5, margin: null },
    },
    tieBreaker: { type: "extra_frame", rules: "Re-spotted black ball with referee oversight" },
    participantConfig: { type: "individual", playersPerSide: 1, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points", "head-to-head", "frame-ratio", "centuries", "highest-break", "WSF-ranking"],
    },
    rules: {
      maxPlayersPerTeam: 1, minPlayersPerTeam: 1, warmupTime: 5,
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {
      ballType: "WSF approved match balls",
      tableSize: "12ft x 6ft (WSF certified)",
    },
  },
};

// ═══════════════════════════════════════════
//  TURF GAMES (Custom)
// ═══════════════════════════════════════════
const turfGames = {
  district: {
    description: "District Turf Games — Custom format, flexible rules",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "head-to-head"],
    },
    rules: {
      refereeRequired: false, umpiresCount: 0, scorerRequired: false,
    },
    equipment: {},
  },
  state: {
    description: "State Turf Games — Custom format",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "head-to-head"],
    },
    rules: {
      refereeRequired: true, umpiresCount: 1, scorerRequired: false,
    },
    equipment: {},
  },
  national: {
    description: "National Turf Games — Custom format",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "head-to-head"],
    },
    rules: {
      refereeRequired: true, umpiresCount: 2, scorerRequired: true,
    },
    equipment: {},
  },
  international: {
    description: "International Turf Games — Custom format",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 3, pointsForLoss: 0, pointsForDraw: 1,
      rankingCriteria: ["points", "head-to-head"],
    },
    rules: {
      refereeRequired: true, umpiresCount: 2, thirdUmpire: true, scorerRequired: true,
    },
    equipment: {},
  },
};

// ═══════════════════════════════════════════
//  CRICKET NETS (Practice)
// ═══════════════════════════════════════════
const cricketNets = {
  district: {
    description: "District Cricket Nets — Practice session",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points"],
    },
    rules: {
      refereeRequired: false, umpiresCount: 0, scorerRequired: false,
    },
    equipment: { ballType: "Leather / Tennis ball" },
  },
  state: {
    description: "State Cricket Nets — Practice session",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points"],
    },
    rules: {
      refereeRequired: false, umpiresCount: 0, scorerRequired: false,
    },
    equipment: { ballType: "Leather ball" },
  },
  national: {
    description: "National Cricket Nets — Practice session",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points"],
    },
    rules: {
      refereeRequired: false, umpiresCount: 0, scorerRequired: true,
    },
    equipment: { ballType: "SG / Kookaburra leather ball" },
  },
  international: {
    description: "International Cricket Nets — Practice session",
    gameStructureType: "single",
    format: {},
    scoring: {
      type: "points",
      winCondition: { type: "most-points", value: null, margin: null },
    },
    tieBreaker: { type: "none", rules: null },
    participantConfig: { type: "team", playersPerSide: null, squadSize: null },
    tournamentRules: {
      pointsForWin: 1, pointsForLoss: 0, pointsForDraw: 0,
      rankingCriteria: ["points"],
    },
    rules: {
      refereeRequired: false, umpiresCount: 0, scorerRequired: true,
    },
    equipment: { ballType: "ICC approved match ball" },
  },
};

// ═══════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════

const sportRulePresets = {
  "table-tennis": tableTennis,
  badminton,
  pickleball,
  tennis,
  cricket,
  football,
  basketball,
  volleyball,
  hockey,
  kabaddi,
  chess,
  carrom,
  snooker,
  "turf-games": turfGames,
  "cricket-nets": cricketNets,
};

module.exports = { sportRulePresets, LEVELS };
