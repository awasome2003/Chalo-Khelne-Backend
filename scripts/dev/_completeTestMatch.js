/**
 * One-off: complete the cricket test match M1 (Royal Strikers vs Thunder Kings)
 * so the COMPLETED detail view can be tested on mobile.
 *
 * Mirrors groupStageScoreboardController's finish logic:
 *  - adds innings 2 (player2 chasing), recomputes aggregates like _recomputeInnings
 *  - marks both innings COMPLETED
 *  - resolves winner + margin like _resolveCricketResultAndFinalize
 *  - sets result.winner / finalScore / completedAt and rebuilds match.matchResult
 *
 * Run:  node _completeTestMatch.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const { readMatchResult } = require("../../utils/matchUtils");

const MATCH_ID = "6a3cb5c45a7e3174b6b3a94e";

// Same maths as controller's _recomputeInnings.
function recomputeInnings(inn) {
  let runs = 0, wickets = 0, legalBalls = 0;
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
  const fow = [];
  for (const d of inn.deliveries || []) {
    const off = Number(d.runs) || 0;
    const ex = Number(d.extraRuns) || 0;
    runs += off + ex;
    if (d.extra === "wide") extras.wides += ex || 1;
    else if (d.extra === "no-ball") extras.noBalls += ex || 1;
    else if (d.extra === "bye") extras.byes += ex;
    else if (d.extra === "leg-bye") extras.legByes += ex;
    if (d.legalDelivery !== false) legalBalls += 1;
    if (d.isWicket) {
      wickets += 1;
      fow.push({ wicket: wickets, runs, over: Math.floor(legalBalls / 6) + (legalBalls % 6) / 10 });
    }
  }
  inn.runs = runs;
  inn.wickets = wickets;
  inn.oversBowled = Math.floor(legalBalls / 6);
  inn.ballsBowled = legalBalls % 6;
  inn.extras = extras;
  inn.fallOfWickets = fow;
}

const D = (runs, opts = {}) => ({
  runs, extra: opts.extra || null, extraRuns: opts.extraRuns || 0,
  isWicket: !!opts.isWicket, wicketType: opts.wicketType || null,
  legalDelivery: opts.legalDelivery !== false,
});

const ROSTERS = {
  "Royal Strikers": ["Rohit Sharma", "Virat Kohli", "Suryakumar Yadav", "Hardik Pandya", "Ravindra Jadeja", "Jasprit Bumrah"],
  "Thunder Kings": ["MS Dhoni", "Ruturaj Gaikwad", "Shivam Dube", "Moeen Ali", "Deepak Chahar", "Matheesha Pathirana"],
};

// Walk the deliveries and stamp who faced (striker) and bowled (bowler), with
// realistic strike rotation — same rules as the scorer.
function assignRoles(deliveries, battingOrder, bowlingOrder) {
  let striker = battingOrder[0] || null;
  let nonStriker = battingOrder[1] || null;
  let wickets = 0, legal = 0, bowlerIdx = 0;
  let bowler = bowlingOrder[0] || null;
  for (const d of deliveries) {
    d.striker = striker;
    d.bowler = bowler;
    const isLegal = d.legalDelivery !== false;
    const off = Number(d.runs) || 0;
    if (d.isWicket) {
      wickets += 1;
      striker = battingOrder[wickets + 1] || null;
    } else if (isLegal && off % 2 === 1) {
      [striker, nonStriker] = [nonStriker, striker];
    }
    if (isLegal) {
      legal += 1;
      if (legal % 6 === 0) {
        [striker, nonStriker] = [nonStriker, striker];
        bowlerIdx = (bowlerIdx + 1) % bowlingOrder.length;
        bowler = bowlingOrder[bowlerIdx];
      }
    }
  }
  return { striker, nonStriker, currentBowler: bowler };
}

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI missing from .env"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected.");

  const match = await Match.findById(MATCH_ID);
  if (!match) { console.error("Match not found:", MATCH_ID); process.exit(1); }

  match.result = match.result?.toObject ? match.result.toObject() : (match.result || {});

  // ── Innings 1: Royal Strikers — full 5 overs, ball by ball ──
  const deliveries1 = [
    // Over 1
    D(1), D(4), D(0), D(6), D(0, { extra: "wide", extraRuns: 1, legalDelivery: false }), D(2), D(1),
    // Over 2
    D(0, { isWicket: true }), D(1), D(4), D(2), D(0), D(6),
    // Over 3
    D(2), D(1), D(0, { extra: "no-ball", extraRuns: 1, legalDelivery: false }), D(4), D(1), D(0), D(6),
    // Over 4
    D(1), D(0, { isWicket: true }), D(4), D(2), D(1), D(0),
    // Over 5
    D(6), D(1), D(4), D(0, { isWicket: true }), D(2), D(1),
  ];
  const inn1 = {
    inningsNumber: 1, battingSide: "player1", deliveries: deliveries1,
    runs: 0, wickets: 0, oversBowled: 0, ballsBowled: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    target: null, status: "COMPLETED", overLog: [], fallOfWickets: [],
  };
  recomputeInnings(inn1);
  const target = (inn1.runs || 0) + 1;

  // ── Innings 2: Thunder Kings — chases, falls short over 5 overs ──
  const deliveries2 = [
    // Over 1
    D(4), D(0), D(1), D(6), D(2), D(0),
    // Over 2
    D(0, { isWicket: true }), D(4), D(1), D(0, { extra: "wide", extraRuns: 1, legalDelivery: false }), D(2), D(1), D(0),
    // Over 3
    D(6), D(1), D(0, { isWicket: true }), D(4), D(2), D(0),
    // Over 4
    D(1), D(2), D(0, { isWicket: true }), D(4), D(1), D(0),
    // Over 5
    D(1), D(0, { isWicket: true }), D(4), D(2), D(0, { isWicket: true }), D(1),
  ];
  const inn2 = {
    inningsNumber: 2, battingSide: "player2", deliveries: deliveries2,
    runs: 0, wickets: 0, oversBowled: 0, ballsBowled: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    target, status: "COMPLETED", overLog: [], fallOfWickets: [],
  };
  recomputeInnings(inn2);

  // Lineups + per-ball striker/bowler so the detail shows batting/bowling cards.
  const bat1 = ROSTERS["Royal Strikers"], bowl1 = ROSTERS["Thunder Kings"];
  const bat2 = ROSTERS["Thunder Kings"], bowl2 = ROSTERS["Royal Strikers"];
  inn1.battingOrder = bat1; inn1.bowlingOrder = bowl1;
  inn2.battingOrder = bat2; inn2.bowlingOrder = bowl2;
  const r1roles = assignRoles(inn1.deliveries, bat1, bowl1);
  const r2roles = assignRoles(inn2.deliveries, bat2, bowl2);
  inn1.striker = r1roles.striker; inn1.nonStriker = r1roles.nonStriker; inn1.currentBowler = r1roles.currentBowler;
  inn2.striker = r2roles.striker; inn2.nonStriker = r2roles.nonStriker; inn2.currentBowler = r2roles.currentBowler;

  const innings = [inn1, inn2];
  match.result.innings = innings;
  const i1 = inn1;

  // 3) Resolve winner + margin (same as _resolveCricketResultAndFinalize).
  const sideRuns = { player1: 0, player2: 0 };
  innings.forEach((i) => { if (i.inningsNumber <= 2 && i.battingSide) sideRuns[i.battingSide] += i.runs || 0; });
  let winnerSide = sideRuns.player1 === sideRuns.player2 ? null
    : (sideRuns.player1 > sideRuns.player2 ? "player1" : "player2");
  const chasingSide = inn2.battingSide;
  const cricketResult = { marginType: null, marginValue: null, isTie: false, superOver: null, chasedSuccessfully: false };
  if (!winnerSide) { cricketResult.isTie = true; cricketResult.marginType = "tie"; }
  else if (winnerSide === chasingSide) {
    cricketResult.marginType = "wickets"; cricketResult.marginValue = 10 - (inn2.wickets || 0); cricketResult.chasedSuccessfully = true;
  } else {
    cricketResult.marginType = "runs"; cricketResult.marginValue = Math.abs(sideRuns.player1 - sideRuns.player2);
  }

  const sideObj = (side) => ({
    playerId: side === "player1" ? match.player1.playerId : match.player2.playerId,
    playerName: side === "player1"
      ? (match.player1.playerName || match.player1.userName)
      : (match.player2.playerName || match.player2.userName),
  });

  match.result.cricketResult = cricketResult;
  match.result.winner = winnerSide ? sideObj(winnerSide) : { playerId: null, playerName: null };
  match.result.finalScore = { player1Sets: winnerSide === "player1" ? 1 : 0, player2Sets: winnerSide === "player2" ? 1 : 0 };
  match.result.completedAt = new Date();
  match.status = "COMPLETED";
  match.scoringType = "innings";
  match.markModified("result");

  // 4) Rebuild the denormalized matchResult DIRECTLY from the fresh innings.
  //    NOTE: readMatchResult() short-circuits on an existing matchResult, so
  //    calling it here would copy the STALE details forward. Build explicitly.
  match.matchResult = {
    type: "innings",
    completed: true,
    player1Score: inn1.runs,
    player2Score: inn2.runs,
    winner: match.result.winner,
    details: innings,
    cricketResult,
  };
  match.markModified("matchResult");

  // 5) Keep liveScore consistent with the final innings (some readers use it).
  match.liveScore = {
    ...(match.liveScore?.toObject ? match.liveScore.toObject() : (match.liveScore || {})),
    scoringType: "innings",
    currentInnings: 2,
    battingPlayer: "player2",
    innings,
  };
  match.markModified("liveScore");

  await match.save();

  console.log("✅ Match completed.");
  console.log(JSON.stringify({
    status: match.status,
    innings1: `${i1?.runs}/${i1?.wickets} (${i1?.oversBowled}.${i1?.ballsBowled})`,
    innings2: `${inn2.runs}/${inn2.wickets} (${inn2.oversBowled}.${inn2.ballsBowled})`,
    winner: match.result.winner,
    cricketResult: match.result.cricketResult,
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => { console.error("FAILED:", e.message); try { await mongoose.disconnect(); } catch {} process.exit(1); });
