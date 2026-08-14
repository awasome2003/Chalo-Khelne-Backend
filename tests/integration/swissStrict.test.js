"use strict";
/**
 * Swiss — strict full-module verification.
 *
 * The other Swiss suites test pieces: pairing in isolation, the model's
 * isolation, the round lifecycle, the scoring reuse, the tiebreak maths. This
 * one runs COMPLETE events through the real HTTP stack and checks the whole
 * thing hangs together.
 *
 * Every derived value the API reports is recomputed independently here from the
 * raw match documents. If the controller and this file ever disagree about a
 * score, a Buchholz, or a rank, that is a real defect in one of them — the test
 * deliberately does not reuse the controller's own helpers to check the
 * controller's own output.
 */
const request = require("supertest");
const {
  startTestApp, stopTestApp, superAdminToken, clearDatabase,
} = require("./setup");

const Tournament = require("../../src/modules/tournaments/models/Tournament");
const Sport = require("../../src/modules/catalog/models/Sport");
const SwissMatch = require("../../src/modules/tournaments/models/SwissMatch");

let app;
let token;

beforeAll(async () => { app = await startTestApp(); });
afterAll(stopTestApp);
beforeEach(async () => { await clearDatabase(); token = superAdminToken(); });

const field = (n) =>
  Array.from({ length: n }, (_, i) => ({ userName: `P${String(i + 1).padStart(2, "0")}`, seed: i + 1 }));

async function seed() {
  const sport = await Sport.create({ name: "Badminton", category: "Racquet", scoringType: "sets" });
  const t = await Tournament.create({
    title: "Strict Swiss Cup",
    sports: [{
      sportId: sport._id, sportName: "Badminton", tournamentLevel: "unranked", type: "swiss",
      categories: [{ name: "Open", fee: 0 }],
      matchFormat: { scoringType: "sets", totalSets: 3, setsToWin: 2, pointsPerSet: 21 },
    }],
  });
  return { tournamentId: String(t._id), sportId: String(sport._id) };
}

const api = {
  start: (tid, body) => request(app).post(`/api/tournaments/swiss/${tid}/start`)
    .set("Authorization", `Bearer ${token}`).send(body),
  next: (tid, body) => request(app).post(`/api/tournaments/swiss/${tid}/next-round`)
    .set("Authorization", `Bearer ${token}`).send(body),
  get: (tid, sportId) => request(app)
    .get(`/api/tournaments/swiss/${tid}?sportId=${sportId}&category=Open`)
    .set("Authorization", `Bearer ${token}`),
  bulk: (tid, scores) => request(app).post("/api/tournaments/matches/bulk-upload-scores")
    .set("Authorization", `Bearer ${token}`).send({ tournamentId: tid, scores }),
};

/**
 * Score a whole round through the REAL bulk-upload endpoint.
 * `outcome(match, index)` returns "player1" | "player2" | "draw".
 */
async function scoreRoundViaApi(tournamentId, round, outcome) {
  const matches = await SwissMatch.find({ tournamentId, swissRound: round, isBye: false })
    .sort({ matchNumber: 1 });

  const scores = matches.map((m, i) => {
    const o = outcome(m, i);
    if (o === "draw") {
      // A drawn best-of-3: one set each. The engine records no winner.
      return { matchId: String(m._id), sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 15, player2Score: 21 }] };
    }
    const p1Wins = o === "player1";
    return {
      matchId: String(m._id),
      sets: [
        { player1Score: p1Wins ? 21 : 15, player2Score: p1Wins ? 15 : 21 },
        { player1Score: p1Wins ? 21 : 12, player2Score: p1Wins ? 12 : 21 },
      ],
    };
  });

  const res = await api.bulk(tournamentId, scores);
  expect(res.status).toBe(200);
  return res;
}

/** Independent recomputation of everything the API derives. */
function recompute(matches) {
  const id = (p) => (p?.playerId ? String(p.playerId) : `name:${(p?.userName || "").trim()}`);
  const scores = {}, opponents = {}, beat = {}, drew = {}, byes = {};
  const played = {}, won = {}, lost = {}, drawn = {};
  const seenPairs = new Set();

  const touch = (k) => {
    if (scores[k] === undefined) {
      scores[k] = 0; opponents[k] = []; beat[k] = []; drew[k] = [];
      byes[k] = 0; played[k] = 0; won[k] = 0; lost[k] = 0; drawn[k] = 0;
    }
  };

  for (const m of matches) {
    if (m.isBye) {
      const b = id(m.player1);
      touch(b);
      scores[b] += 1;
      byes[b] += 1;
      continue;
    }
    if (String(m.status).toUpperCase() !== "COMPLETED") continue;

    const a = id(m.player1), c = id(m.player2);
    touch(a); touch(c);

    seenPairs.add([a, c].sort().join("|"));
    opponents[a].push(c);
    opponents[c].push(a);
    played[a] += 1; played[c] += 1;

    if (m.result?.isDraw) {
      scores[a] += 0.5; scores[c] += 0.5;
      drawn[a] += 1; drawn[c] += 1;
      drew[a].push(c); drew[c].push(a);
      continue;
    }
    const w = m.result?.winner;
    const wid = w?.playerId ? String(w.playerId) : `name:${(w?.playerName || "").trim()}`;
    const loserId = wid === a ? c : a;
    scores[wid] += 1;
    won[wid] += 1; lost[loserId] += 1;
    beat[wid].push(loserId);
  }

  const buchholz = (k) => opponents[k].reduce((s, o) => s + (scores[o] || 0), 0);
  const sb = (k) =>
    beat[k].reduce((s, o) => s + (scores[o] || 0), 0) +
    drew[k].reduce((s, o) => s + (scores[o] || 0), 0) / 2;

  return { scores, opponents, byes, played, won, lost, drawn, buchholz, sb, seenPairs };
}

/** Run a complete event, asserting invariants after every round. */
async function runEvent({ playerCount, rounds, outcome = () => "player1" }) {
  const { tournamentId, sportId } = await seed();

  const started = await api.start(tournamentId, {
    sportId, category: "Open", players: field(playerCount), rounds,
    courtCount: 4, matchDurationMinutes: 30, gapMinutes: 10,
  });
  expect(started.status).toBe(201);

  const allPairs = new Set();

  for (let round = 1; round <= rounds; round++) {
    const inRound = await SwissMatch.find({ tournamentId, swissRound: round });

    // Every entrant appears exactly once per round — playing or on the bye.
    const involved = [];
    for (const m of inRound) {
      involved.push(m.player1.userName);
      if (!m.isBye) involved.push(m.player2.userName);
    }
    expect(involved).toHaveLength(playerCount);
    expect(new Set(involved).size).toBe(playerCount);

    // At most one bye, and only when the field is odd.
    const byeCount = inRound.filter((m) => m.isBye).length;
    expect(byeCount).toBe(playerCount % 2 === 0 ? 0 : 1);

    // No fixture is ever repeated.
    for (const m of inRound.filter((x) => !x.isBye)) {
      const key = [m.player1.userName, m.player2.userName].sort().join("|");
      expect(allPairs.has(key)).toBe(false);
      allPairs.add(key);
    }

    // Every scheduled match got a court and a time.
    for (const m of inRound.filter((x) => !x.isBye)) {
      expect(m.courtNumber).toBeTruthy();
      expect(m.matchStartTime).toBeTruthy();
      expect(new Date(m.matchEndTime).getTime())
        .toBeGreaterThan(new Date(m.matchStartTime).getTime());
    }

    await scoreRoundViaApi(tournamentId, round, outcome);

    if (round < rounds) {
      const next = await api.next(tournamentId, { sportId, category: "Open", courtCount: 4 });
      expect(next.status).toBe(201);
      expect(next.body.round).toBe(round + 1);
    }
  }

  return { tournamentId, sportId, allPairs };
}

describe("a complete 16-player, 4-round event", () => {
  let ctx;
  beforeEach(async () => {
    ctx = await runEvent({ playerCount: 16, rounds: 4 });
  });

  test("produces exactly the expected number of distinct fixtures", async () => {
    const all = await SwissMatch.find({ tournamentId: ctx.tournamentId, isBye: false });
    expect(all).toHaveLength(4 * 8);
    expect(ctx.allPairs.size).toBe(32);
  });

  test("everyone played every round", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const t = recompute(matches);
    for (const p of field(16)) {
      expect(t.played[`name:${p.userName}`]).toBe(4);
    }
  });

  test("points awarded equal points available", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const t = recompute(matches);
    const total = Object.values(t.scores).reduce((a, b) => a + b, 0);
    // Each of the 32 matches distributes exactly one point; no byes here.
    expect(total).toBe(32);
  });

  test("the API's standings match an independent recomputation exactly", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const t = recompute(matches);
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    expect(res.status).toBe(200);

    expect(res.body.standings).toHaveLength(16);
    for (const row of res.body.standings) {
      expect(row.score).toBe(t.scores[row.id]);
      expect(row.played).toBe(t.played[row.id]);
      expect(row.won).toBe(t.won[row.id]);
      expect(row.lost).toBe(t.lost[row.id]);
      expect(row.drawn).toBe(t.drawn[row.id]);
      expect(row.buchholz).toBe(t.buchholz(row.id));
      expect(row.sonnebornBerger).toBe(t.sb(row.id));
      // Internal consistency of the row itself.
      expect(row.won + row.lost + row.drawn).toBe(row.played);
    }
  });

  test("standings are ordered by the documented tiebreak chain", async () => {
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    const rows = res.body.standings;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      const ka = [a.score, a.buchholz, a.sonnebornBerger, a.won];
      const kb = [b.score, b.buchholz, b.sonnebornBerger, b.won];
      let decided = false;
      for (let k = 0; k < ka.length; k++) {
        if (ka[k] !== kb[k]) { expect(ka[k]).toBeGreaterThan(kb[k]); decided = true; break; }
      }
      if (!decided) {
        // Fully level ⇒ same rank, flagged, and ordered by name.
        expect(a.rank).toBe(b.rank);
        expect(a.tied).toBe(true);
        expect(String(a.name).localeCompare(String(b.name))).toBeLessThanOrEqual(0);
      } else {
        expect(a.rank).toBeLessThan(b.rank);
      }
    }
  });

  test("exactly one player is undefeated after 4 rounds of 16", async () => {
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    const perfect = res.body.standings.filter((r) => r.score === 4);
    expect(perfect).toHaveLength(1);
    expect(perfect[0].rank).toBe(1);
  });

  test("the event reports itself finished", async () => {
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    expect(res.body.currentRound).toBe(4);
    expect(res.body.isFinalRound).toBe(true);
    expect(res.body.canGenerateNextRound).toBe(false);
    expect(res.body.rounds.every((r) => r.complete)).toBe(true);
  });

  test("no further round can be generated", async () => {
    const res = await api.next(ctx.tournamentId, { sportId: ctx.sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.complete).toBe(true);
    expect(await SwissMatch.countDocuments({ tournamentId: ctx.tournamentId, swissRound: 5 })).toBe(0);
  });
});

describe("an odd field — byes", () => {
  let ctx;
  beforeEach(async () => {
    // No draws here on purpose: this event is badminton, and a best-of-3 set
    // match CANNOT be drawn — someone must take 2 sets. Drawn results are
    // covered separately below, for the sports that can actually produce one.
    // Upsets are used instead to cluster players on equal scores, which is the
    // state in which legal pairings are scarcest.
    ctx = await runEvent({
      playerCount: 15,
      rounds: 4,
      outcome: (_m, i) => (i % 3 === 0 ? "player2" : "player1"),
    });
  });

  test("each round has exactly one bye and it never repeats", async () => {
    const byes = await SwissMatch.find({ tournamentId: ctx.tournamentId, isBye: true });
    expect(byes).toHaveLength(4);
    expect(new Set(byes.map((b) => b.player1.userName)).size).toBe(4);
  });

  test("points awarded equal points available, byes included", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const t = recompute(matches);
    const total = Object.values(t.scores).reduce((a, b) => a + b, 0);
    // 7 matches x 4 rounds = 28 points, plus 4 byes at 1 point each.
    expect(total).toBe(28 + 4);
  });

  test("a set-based match cannot be drawn — the engine refuses 1-1", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(4), rounds: 2 });
    const [m] = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });

    const res = await api.bulk(tournamentId, [{
      matchId: String(m._id),
      // One set each: nobody reaches the 2 needed to win a best-of-3.
      sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 15, player2Score: 21 }],
    }]);

    expect(res.body.errors.length).toBe(1);
    expect((await SwissMatch.findById(m._id)).status).not.toBe("COMPLETED");
  });

  test("a bye scores a point without counting as a match played", async () => {
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    const withBye = res.body.standings.filter((r) => r.byes > 0);
    expect(withBye).toHaveLength(4);
    for (const r of withBye) {
      expect(r.played).toBe(4 - r.byes);
      expect(r.won + r.lost + r.drawn).toBe(r.played);
    }
  });

  test("the API's standings still match an independent recomputation", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const t = recompute(matches);
    const res = await api.get(ctx.tournamentId, ctx.sportId);

    for (const row of res.body.standings) {
      expect(row.score).toBe(t.scores[row.id]);
      expect(row.byes).toBe(t.byes[row.id]);
      expect(row.buchholz).toBe(t.buchholz(row.id));
      expect(row.sonnebornBerger).toBe(t.sb(row.id));
    }
  });

  test("a bye contributes nothing to Buchholz", async () => {
    const matches = await SwissMatch.find({ tournamentId: ctx.tournamentId }).lean();
    const res = await api.get(ctx.tournamentId, ctx.sportId);
    const t = recompute(matches);

    for (const row of res.body.standings.filter((r) => r.byes > 0)) {
      // Opponent list is shorter than rounds played, and Buchholz sums only
      // those real opponents.
      expect(row.opponents).toHaveLength(4 - row.byes);
      expect(row.buchholz).toBe(t.buchholz(row.id));
    }
  });
});

describe("drawn results", () => {
  /**
   * Draws are recorded directly rather than through the bulk endpoint, because
   * that endpoint only accepts set-based sports and a set-based match cannot be
   * drawn (see the test above). A draw is a real outcome for chess and for
   * time-based sports, so Swiss must score it correctly wherever it comes from.
   */
  test("a draw is half a point each and counts as a match played", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(4), rounds: 2 });

    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });
    for (const m of r1) {
      m.status = "COMPLETED";
      m.result = {
        winner: { playerId: null, playerName: null },
        finalScore: { player1Sets: 1, player2Sets: 1 },
        isDraw: true,
        completedAt: new Date(),
      };
      await m.save({ validateModifiedOnly: true });
    }

    const res = await api.get(tournamentId, sportId);
    expect(res.body.standings).toHaveLength(4);
    for (const row of res.body.standings) {
      expect(row.score).toBe(0.5);
      expect(row.drawn).toBe(1);
      expect(row.played).toBe(1);
      expect(row.won).toBe(0);
      expect(row.lost).toBe(0);
    }
    // Four players on half a point each = 2 points, one per match.
    const total = res.body.standings.reduce((s, r) => s + r.score, 0);
    expect(total).toBe(2);
  });

  test("a draw written the SHARED LIVE SCORER's way is still read as a draw", async () => {
    // The shared scorer records a genuine group-stage draw for a time or single
    // sport (Football, Chess) by CLEARING the winner — it does not set isDraw.
    // That object is truthy, so a naive read derives a phantom winner id and
    // scores the draw as a loss for BOTH players. Swiss must handle both shapes.
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(4), rounds: 2 });

    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });
    for (const m of r1) {
      m.status = "COMPLETED";
      m.result = {
        winner: { playerId: null, playerName: null }, // cleared, NOT flagged
        finalScore: { player1Sets: 2, player2Sets: 2 },
        completedAt: new Date(),
      };
      await m.save({ validateModifiedOnly: true });
    }

    const res = await api.get(tournamentId, sportId);
    for (const row of res.body.standings) {
      expect(row.score).toBe(0.5);   // was 0 before the fix
      expect(row.drawn).toBe(1);
      expect(row.lost).toBe(0);      // was 1 for BOTH players before the fix
    }
    expect(res.body.standings.reduce((s, r) => s + r.score, 0)).toBe(2);
  });

  test("Sonneborn-Berger counts a drawn opponent at half their score", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(4), rounds: 2 });

    const r1 = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });
    // Match 1 drawn; match 2 decided, so the drawn pair's opponents differ in
    // strength and SB can actually discriminate.
    r1[0].status = "COMPLETED";
    r1[0].result = {
      winner: { playerId: null, playerName: null },
      finalScore: { player1Sets: 1, player2Sets: 1 },
      isDraw: true, completedAt: new Date(),
    };
    await r1[0].save({ validateModifiedOnly: true });

    r1[1].status = "COMPLETED";
    r1[1].result = {
      winner: { playerId: null, playerName: r1[1].player1.userName },
      finalScore: { player1Sets: 2, player2Sets: 0 },
      isDraw: false, completedAt: new Date(),
    };
    await r1[1].save({ validateModifiedOnly: true });

    const res = await api.get(tournamentId, sportId);
    const rows = Object.fromEntries(res.body.standings.map((r) => [r.name, r]));

    // Each drawn player took half a point from an opponent also on 0.5.
    const a = rows[r1[0].player1.userName];
    expect(a.sonnebornBerger).toBe(0.25); // half of the opponent's 0.5

    // The outright winner beat someone on 0 — SB of 0 despite a full point.
    const w = rows[r1[1].player1.userName];
    expect(w.score).toBe(1);
    expect(w.sonnebornBerger).toBe(0);
  });
});

describe("the module refuses to be driven into an invalid state", () => {
  test("a round cannot be skipped", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(8), rounds: 3 });

    // Round 1 unscored — the next round must be refused, and nothing created.
    const res = await api.next(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(await SwissMatch.countDocuments({ tournamentId, swissRound: 2 })).toBe(0);
  });

  test("a partially scored round is still refused", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(8), rounds: 3 });

    const [first] = await SwissMatch.find({ tournamentId, swissRound: 1 }).sort({ matchNumber: 1 });
    await api.bulk(tournamentId, [{
      matchId: String(first._id),
      sets: [{ player1Score: 21, player2Score: 15 }, { player1Score: 21, player2Score: 12 }],
    }]);

    const res = await api.next(tournamentId, { sportId, category: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.pending).toHaveLength(3);
  });

  test("a field cannot be pushed past its pairing capacity", async () => {
    const { tournamentId, sportId } = await seed();
    // 4 players: after 3 rounds everyone has met everyone.
    await api.start(tournamentId, { sportId, category: "Open", players: field(4), rounds: 3 });
    for (let r = 1; r <= 3; r++) {
      await scoreRoundViaApi(tournamentId, r, () => "player1");
      if (r < 3) {
        expect((await api.next(tournamentId, { sportId, category: "Open" })).status).toBe(201);
      }
    }
    const all = await SwissMatch.find({ tournamentId, isBye: false });
    const pairs = new Set(all.map((m) => [m.player1.userName, m.player2.userName].sort().join("|")));
    // A complete round robin: every one of the 6 possible pairs, exactly once.
    expect(pairs.size).toBe(6);
    expect(all).toHaveLength(6);
  });

  test("resetting removes the event entirely and allows a fresh start", async () => {
    const { tournamentId, sportId } = await seed();
    await api.start(tournamentId, { sportId, category: "Open", players: field(8), rounds: 3 });
    await scoreRoundViaApi(tournamentId, 1, () => "player1");

    await request(app)
      .delete(`/api/tournaments/swiss/${tournamentId}?sportId=${sportId}&category=Open`)
      .set("Authorization", `Bearer ${token}`);

    expect(await SwissMatch.countDocuments({ tournamentId })).toBe(0);
    const res = await api.get(tournamentId, sportId);
    expect(res.body.exists).toBe(false);

    // A different-sized event can now be started in its place.
    const restart = await api.start(tournamentId, {
      sportId, category: "Open", players: field(6), rounds: 3,
    });
    expect(restart.status).toBe(201);
  });
});

describe("swiss does not disturb the rest of the platform", () => {
  test("a full event leaves the other match collections empty", async () => {
    const { tournamentId } = await runEvent({ playerCount: 8, rounds: 3 });

    const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
    const DirectKnockoutMatch = require("../../src/modules/tournaments/models/DirectKnockoutMatch");
    const SuperMatch = require("../../src/modules/tournaments/models/SuperMatch");

    expect(await Match.countDocuments({ tournamentId })).toBe(0);
    expect(await DirectKnockoutMatch.countDocuments({ tournamentId })).toBe(0);
    expect(await SuperMatch.countDocuments({ tournamentId })).toBe(0);
    expect(await SwissMatch.countDocuments({ tournamentId })).toBe(12);
  });
});
