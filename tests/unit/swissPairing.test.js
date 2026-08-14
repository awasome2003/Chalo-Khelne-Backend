"use strict";
/**
 * Swiss pairing.
 *
 * The pairing algorithm is the whole risk in Swiss — everything else is
 * plumbing. These tests prove the four properties an event actually depends on:
 *
 *   1. no pairing is ever repeated
 *   2. players on equal scores meet each other
 *   3. byes are distributed fairly and never twice to one player
 *   4. the same state always produces the same pairings
 *
 * The multi-round simulations at the bottom are the important ones: they run a
 * whole event and assert the invariants after every round, which is the only
 * way a stranded-pairing bug shows up.
 */
const {
  recommendedRounds,
  maxRounds,
  pairSwissRound,
  applyRoundResults,
} = require("../../utils/swissPairing");

const field = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, seed: i + 1 }));

/** Play a round: the higher-seeded player always wins, for determinism. */
function playRound(pairings, upsetIds = new Set()) {
  return pairings.map(({ player1, player2 }) => {
    const p1Stronger = player1.seed < player2.seed;
    const favourite = p1Stronger ? player1 : player2;
    const underdog = p1Stronger ? player2 : player1;
    const winner = upsetIds.has(underdog.id) ? underdog : favourite;
    return { player1Id: player1.id, player2Id: player2.id, winnerId: winner.id };
  });
}

/** Run a full event, asserting invariants after every round. */
function runEvent(playerCount, rounds, opts = {}) {
  const players = field(playerCount);
  let state = { scores: {}, opponents: {}, byes: {} };
  const seenPairs = new Set();
  const byeLog = [];

  for (let round = 1; round <= rounds; round++) {
    const { pairings, bye, exhausted } = pairSwissRound({
      players, round, ...state, ...opts,
    });
    expect(exhausted).toBe(false);

    // Every player is accounted for exactly once: playing, or on the bye.
    const involved = pairings.flatMap((p) => [p.player1.id, p.player2.id]);
    if (bye) involved.push(bye.id);
    expect(new Set(involved).size).toBe(playerCount);
    expect(involved).toHaveLength(playerCount);

    // No rematches, ever.
    for (const { player1, player2 } of pairings) {
      const key = [player1.id, player2.id].sort().join("|");
      expect(seenPairs.has(key)).toBe(false);
      seenPairs.add(key);
    }

    if (bye) byeLog.push(bye.id);
    state = applyRoundResults(state, playRound(pairings), bye?.id);
  }

  return { state, byeLog, seenPairs };
}

describe("round-count helpers", () => {
  test("recommends ceil(log2(n)) rounds", () => {
    expect(recommendedRounds(8)).toBe(3);
    expect(recommendedRounds(16)).toBe(4);
    expect(recommendedRounds(32)).toBe(5);
    expect(recommendedRounds(40)).toBe(6);
  });

  test("caps at n-1, beyond which a repeat is unavoidable", () => {
    expect(maxRounds(8)).toBe(7);
    expect(maxRounds(2)).toBe(1);
  });

  test("handles degenerate input", () => {
    expect(recommendedRounds(1)).toBe(0);
    expect(recommendedRounds(0)).toBe(0);
    expect(maxRounds(undefined)).toBe(0);
  });
});

describe("round 1", () => {
  test("splits the field — top half plays bottom half", () => {
    const { pairings, bye } = pairSwissRound({ players: field(8), round: 1 });
    expect(bye).toBeNull();
    expect(pairings).toHaveLength(4);
    // Seed 1 v 5, 2 v 6, 3 v 7, 4 v 8 — keeps the strongest apart early.
    expect(pairings.map((p) => [p.player1.seed, p.player2.seed])).toEqual([
      [1, 5], [2, 6], [3, 7], [4, 8],
    ]);
  });

  test("the top two seeds cannot meet in round 1", () => {
    const { pairings } = pairSwissRound({ players: field(16), round: 1 });
    const meeting = pairings.find(
      (p) => [p.player1.seed, p.player2.seed].sort((a, b) => a - b).join() === "1,2"
    );
    expect(meeting).toBeUndefined();
  });

  test("a random first round still pairs everyone exactly once", () => {
    const { pairings, bye } = pairSwissRound({
      players: field(8), round: 1, randomFirstRound: true, shuffle: (a) => [...a].reverse(),
    });
    expect(bye).toBeNull();
    const ids = pairings.flatMap((p) => [p.player1.id, p.player2.id]);
    expect(new Set(ids).size).toBe(8);
  });
});

describe("byes", () => {
  test("an odd field gives exactly one bye, to the lowest-ranked player", () => {
    const { pairings, bye } = pairSwissRound({ players: field(7), round: 1 });
    expect(bye).not.toBeNull();
    expect(bye.seed).toBe(7);
    expect(pairings).toHaveLength(3);
  });

  test("nobody gets a second bye while someone has had none", () => {
    const { byeLog } = runEvent(9, 4);
    expect(byeLog).toHaveLength(4);
    expect(new Set(byeLog).size).toBe(4); // four different players
  });

  test("a bye counts as a win", () => {
    const next = applyRoundResults({}, [], "p7");
    expect(next.scores.p7).toBe(1);
    expect(next.byes.p7).toBe(1);
  });

  test("an even field gets no bye", () => {
    const { bye } = pairSwissRound({ players: field(8), round: 1 });
    expect(bye).toBeNull();
  });
});

describe("later rounds pair on score", () => {
  test("winners meet winners and losers meet losers in round 2", () => {
    const players = field(8);
    const r1 = pairSwissRound({ players, round: 1 });
    const state = applyRoundResults({}, playRound(r1.pairings), null);

    const r2 = pairSwissRound({ players, round: 2, ...state });
    for (const { player1, player2 } of r2.pairings) {
      // Equal records face each other.
      expect(state.scores[player1.id] || 0).toBe(state.scores[player2.id] || 0);
    }
  });
});

describe("no rematches", () => {
  test("a pairing already played is never repeated", () => {
    const players = field(4);
    const state = {
      scores: { p1: 1, p2: 1, p3: 0, p4: 0 },
      // p1 has met p2, p3 has met p4 — the obvious score pairing is illegal.
      opponents: { p1: ["p2"], p2: ["p1"], p3: ["p4"], p4: ["p3"] },
      byes: {},
    };
    const { pairings, exhausted } = pairSwissRound({ players, round: 2, ...state });
    expect(exhausted).toBe(false);
    for (const { player1, player2 } of pairings) {
      expect(state.opponents[player1.id] || []).not.toContain(player2.id);
    }
  });

  test("backtracks when the greedy choice would strand the last pair", () => {
    // Greedy pairs p1-p2, leaving p3-p4 — who have already met. A correct
    // implementation must back up and pair differently.
    const players = field(4);
    const state = {
      scores: { p1: 1, p2: 1, p3: 1, p4: 1 },
      opponents: { p3: ["p4"], p4: ["p3"] },
      byes: {},
    };
    const { pairings, exhausted } = pairSwissRound({ players, round: 2, ...state });

    expect(exhausted).toBe(false);
    expect(pairings).toHaveLength(2);
    const keys = pairings.map((p) => [p.player1.id, p.player2.id].sort().join("|"));
    expect(keys).not.toContain("p3|p4");
  });

  test("reports exhaustion instead of repeating a fixture", () => {
    // Everyone has played everyone — a 4-player round robin is complete.
    const players = field(4);
    const state = {
      scores: {},
      opponents: {
        p1: ["p2", "p3", "p4"], p2: ["p1", "p3", "p4"],
        p3: ["p1", "p2", "p4"], p4: ["p1", "p2", "p3"],
      },
      byes: {},
    };
    const { pairings, exhausted } = pairSwissRound({ players, round: 4, ...state });
    expect(exhausted).toBe(true);
    expect(pairings).toHaveLength(0);
  });
});

describe("determinism", () => {
  test("the same state always produces the same pairings", () => {
    const players = field(16);
    const state = applyRoundResults(
      {}, playRound(pairSwissRound({ players, round: 1 }).pairings), null
    );
    const a = pairSwissRound({ players, round: 2, ...state });
    const b = pairSwissRound({ players, round: 2, ...state });
    expect(a.pairings.map((p) => [p.player1.id, p.player2.id]))
      .toEqual(b.pairings.map((p) => [p.player1.id, p.player2.id]));
  });
});

describe("applyRoundResults", () => {
  test("records opponents symmetrically", () => {
    const s = applyRoundResults({}, [{ player1Id: "p1", player2Id: "p2", winnerId: "p1" }]);
    expect(s.opponents.p1).toEqual(["p2"]);
    expect(s.opponents.p2).toEqual(["p1"]);
  });

  test("a win is 1 point, a loss 0", () => {
    const s = applyRoundResults({}, [{ player1Id: "p1", player2Id: "p2", winnerId: "p1" }]);
    expect(s.scores.p1).toBe(1);
    expect(s.scores.p2).toBe(0);
  });

  test("a draw is half a point each", () => {
    const s = applyRoundResults({}, [{ player1Id: "p1", player2Id: "p2", winnerId: null }]);
    expect(s.scores.p1).toBe(0.5);
    expect(s.scores.p2).toBe(0.5);
  });

  test("does not mutate the state passed in", () => {
    const before = { scores: { p1: 1 }, opponents: { p1: ["p2"] }, byes: {} };
    applyRoundResults(before, [{ player1Id: "p1", player2Id: "p3", winnerId: "p3" }]);
    expect(before.scores.p1).toBe(1);
    expect(before.opponents.p1).toEqual(["p2"]);
  });
});

// ── Full-event simulations ────────────────────────────────────────────────
// A stranded pairing only appears part-way through a real event, so these run
// the whole thing and check the invariants after every single round.

describe("full events", () => {
  test("32 players, 5 rounds — everyone plays 5, no repeats", () => {
    const { state, seenPairs } = runEvent(32, 5);
    expect(seenPairs.size).toBe(5 * 16);
    for (const p of field(32)) {
      expect(state.opponents[p.id]).toHaveLength(5);
    }
  });

  test("40 players, 6 rounds — the corporate-event case", () => {
    const { state } = runEvent(40, 6);
    for (const p of field(40)) {
      expect(state.opponents[p.id]).toHaveLength(6);
    }
  });

  test("odd field of 21 over 5 rounds stays consistent", () => {
    const { byeLog, state } = runEvent(21, 5);
    expect(byeLog).toHaveLength(5);
    expect(new Set(byeLog).size).toBe(5);
    // Everyone played every round except the one they sat out.
    for (const p of field(21)) {
      const expected = 5 - (byeLog.filter((b) => b === p.id).length);
      expect(state.opponents[p.id] || []).toHaveLength(expected);
    }
  });

  test("survives upsets scrambling the score groups", () => {
    // Upsets create many players on equal scores, which is exactly the state
    // that makes legal pairings scarce.
    const upsets = new Set(["p20", "p21", "p22", "p23", "p30", "p31"]);
    const players = field(32);
    let state = { scores: {}, opponents: {}, byes: {} };
    const seen = new Set();

    for (let round = 1; round <= 5; round++) {
      const { pairings, exhausted } = pairSwissRound({ players, round, ...state });
      expect(exhausted).toBe(false);
      for (const { player1, player2 } of pairings) {
        const key = [player1.id, player2.id].sort().join("|");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      state = applyRoundResults(state, playRound(pairings, upsets), null);
    }
    expect(seen.size).toBe(80);
  });

  test("small field pushed to its limit — 8 players, 7 rounds (full round robin)", () => {
    const { seenPairs } = runEvent(8, 7);
    // 7 rounds of 4 = 28 pairings = every possible pair exactly once.
    expect(seenPairs.size).toBe(28);
    expect(seenPairs.size).toBe((8 * 7) / 2);
  });
});
