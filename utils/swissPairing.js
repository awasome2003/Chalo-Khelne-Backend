"use strict";
/**
 * Swiss pairing — pure functions, no database, no framework.
 *
 * WHAT SWISS IS
 * -------------
 * A fixed number of rounds in which nobody is eliminated. Each round pairs
 * players with similar records, never repeating a pairing. After the final
 * round the standings table is the result.
 *
 * For 32 players over 5 rounds that is 80 matches and everyone plays 5 — versus
 * a knockout where 16 players play once and go home, or a round robin's
 * impossible 496 matches.
 *
 * WHICH VARIANT
 * -------------
 * This is NOT full FIDE Dutch pairing. Dutch adds colour allocation, float
 * history and score-bracket transposition rules that only matter for rated
 * chess. What is implemented here is the widely used simplification:
 *
 *   sort by score, pair each player with the nearest-ranked opponent they have
 *   not already met, backtracking when a greedy choice strands someone.
 *
 * It satisfies the properties a club or corporate event actually needs:
 *   • players on equal scores meet each other
 *   • no pairing is ever repeated
 *   • byes go to the lowest-ranked player who has had fewest of them
 *   • the same inputs always produce the same pairings
 *
 * Colour/serve allocation is deliberately absent — it is meaningless for
 * badminton, table tennis and carrom, which is what this platform runs.
 */

// ── Round-count helpers ────────────────────────────────────────────────────

/**
 * Rounds needed to separate a field: each round halves how many players can
 * still be undefeated, so ceil(log2(n)) rounds leaves exactly one.
 * 8 → 3, 16 → 4, 32 → 5, 40 → 6.
 */
function recommendedRounds(playerCount) {
  const n = Number(playerCount);
  if (!Number.isFinite(n) || n < 2) return 0;
  return Math.ceil(Math.log2(n));
}

/**
 * The hard ceiling. With n players nobody can have more than n-1 distinct
 * opponents, so beyond n-1 rounds a repeat pairing is unavoidable — the field
 * is exhausted and the event has become a round robin.
 */
function maxRounds(playerCount) {
  const n = Number(playerCount);
  if (!Number.isFinite(n) || n < 2) return 0;
  return n - 1;
}

// ── Internals ──────────────────────────────────────────────────────────────

const idOf = (p) => String(p?.id ?? p?._id ?? "");

/**
 * Order the field for pairing: score descending, then seed, then id.
 *
 * The id tiebreak is what makes pairing deterministic — without it two players
 * on the same score and seed could order either way between calls, and the same
 * tournament state would produce different pairings on a retry.
 */
function orderForPairing(players, scores) {
  return [...players].sort((a, b) => {
    const sa = Number(scores[idOf(a)] || 0);
    const sb = Number(scores[idOf(b)] || 0);
    if (sb !== sa) return sb - sa;
    const seedA = Number.isFinite(Number(a.seed)) ? Number(a.seed) : Infinity;
    const seedB = Number.isFinite(Number(b.seed)) ? Number(b.seed) : Infinity;
    if (seedA !== seedB) return seedA - seedB;
    return idOf(a).localeCompare(idOf(b));
  });
}

/**
 * Pair an ordered list so that nobody meets a previous opponent.
 *
 * Greedy alone is not enough. Pairing the first legal candidate can strand the
 * last two players as a pair that has already met, with no way forward — so
 * this backtracks: it takes the first unpaired player, tries each legal partner
 * in nearest-ranked order, and recurses. The first candidate almost always
 * works, which keeps the common case linear.
 *
 * `budget` caps the search so a pathological history cannot hang a request;
 * exceeding it is reported as "no pairing found" rather than throwing.
 */
function pairWithoutRematches(ordered, opponents, budget) {
  if (ordered.length === 0) return [];
  if (ordered.length % 2 !== 0) return null; // caller must remove the bye first

  const [first, ...rest] = ordered;
  const played = opponents[idOf(first)] || [];

  for (let i = 0; i < rest.length; i++) {
    if (budget.steps++ > budget.max) return null;

    const candidate = rest[i];
    if (played.includes(idOf(candidate))) continue;

    const remaining = rest.slice(0, i).concat(rest.slice(i + 1));
    const tail = pairWithoutRematches(remaining, opponents, budget);
    if (tail) return [{ player1: first, player2: candidate }, ...tail];
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Pair one Swiss round.
 *
 * @param {Object}   opts
 * @param {Array}    opts.players   [{ id, name, seed? }] — the full field
 * @param {number}   opts.round     1-based round number
 * @param {Object}   [opts.scores]  { [id]: winsSoFar } — absent = 0
 * @param {Object}   [opts.opponents] { [id]: [opponentIds] } — who each has met
 * @param {Object}   [opts.byes]    { [id]: byeCount } — absent = 0
 * @param {Function} [opts.shuffle] (arr) => arr, used only for a random round 1
 * @param {boolean}  [opts.randomFirstRound=false]
 * @param {number}   [opts.searchBudget=50000]
 *
 * @returns {{ pairings: Array<{player1, player2}>, bye: object|null, exhausted: boolean }}
 *   `exhausted` true means every legal pairing is used up — the caller should
 *   stop the event rather than repeat a fixture.
 */
function pairSwissRound({
  players,
  round = 1,
  scores = {},
  opponents = {},
  byes = {},
  shuffle,
  randomFirstRound = false,
  searchBudget = 50000,
}) {
  if (!Array.isArray(players) || players.length < 2) {
    return { pairings: [], bye: null, exhausted: players?.length === 1 ? false : true };
  }

  let ordered = orderForPairing(players, scores);

  // Round 1 has no scores to pair on. Default is the standard split — the top
  // half plays the bottom half (1 vs 9, 2 vs 10 …), which keeps the strongest
  // players apart early. A random draw is available for casual events.
  const isFirstRound = round <= 1;
  if (isFirstRound && randomFirstRound && typeof shuffle === "function") {
    ordered = shuffle(ordered);
  }

  // Odd field: someone sits out. The bye goes to the lowest-ranked player among
  // those who have had fewest byes, so it never lands twice on one person while
  // another has had none.
  let bye = null;
  if (ordered.length % 2 === 1) {
    const fewest = Math.min(...ordered.map((p) => Number(byes[idOf(p)] || 0)));
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (Number(byes[idOf(ordered[i])] || 0) === fewest) {
        bye = ordered[i];
        break;
      }
    }
    ordered = ordered.filter((p) => idOf(p) !== idOf(bye));
  }

  let pairings;
  if (isFirstRound && !randomFirstRound) {
    // Split pairing: fold the ordered field in half and pair across.
    const half = ordered.length / 2;
    pairings = [];
    for (let i = 0; i < half; i++) {
      pairings.push({ player1: ordered[i], player2: ordered[i + half] });
    }
  } else {
    pairings = pairWithoutRematches(ordered, opponents, { steps: 0, max: searchBudget });
  }

  if (!pairings) return { pairings: [], bye, exhausted: true };
  return { pairings, bye, exhausted: false };
}

/**
 * Fold a completed round back into pairing state.
 *
 * Kept here, beside the pairing rules, so the caller never has to know that a
 * bye counts as a win or that opponent history is symmetric.
 *
 * @param {Object} state   { scores, opponents, byes } — not mutated
 * @param {Array}  results [{ player1Id, player2Id, winnerId }] — winnerId null = draw
 * @param {string} [byeId] player who sat the round out
 * @returns {Object} the next state
 */
function applyRoundResults(state = {}, results = [], byeId = null) {
  const scores = { ...(state.scores || {}) };
  const byes = { ...(state.byes || {}) };
  const opponents = {};
  for (const [k, v] of Object.entries(state.opponents || {})) opponents[k] = [...v];

  const add = (id, opp) => {
    if (!opponents[id]) opponents[id] = [];
    if (opp && !opponents[id].includes(opp)) opponents[id].push(opp);
  };

  for (const r of results) {
    const p1 = String(r.player1Id);
    const p2 = String(r.player2Id);
    add(p1, p2);
    add(p2, p1);

    if (r.winnerId == null) {
      // Draws are half a point each — chess scoring, and the only sane way to
      // rank a drawn result against a win.
      scores[p1] = (scores[p1] || 0) + 0.5;
      scores[p2] = (scores[p2] || 0) + 0.5;
    } else {
      const w = String(r.winnerId);
      scores[w] = (scores[w] || 0) + 1;
      const l = w === p1 ? p2 : p1;
      scores[l] = scores[l] || 0;
    }
  }

  if (byeId) {
    const b = String(byeId);
    // A bye is a full point — the player did not choose to sit out, and scoring
    // it as anything less would penalise them for the field being odd.
    scores[b] = (scores[b] || 0) + 1;
    byes[b] = (byes[b] || 0) + 1;
    if (!opponents[b]) opponents[b] = [];
  }

  return { scores, opponents, byes };
}

// ── Tiebreaks ──────────────────────────────────────────────────────────────
//
// Score alone does not rank a Swiss field. Over 5 rounds a 32-player event
// reliably leaves several players on 4-1, and "who came second" needs an answer
// that can be defended when a participant asks. The standard answer is to
// measure the strength of the opposition each player actually faced.

/**
 * Buchholz — the sum of the final scores of everyone a player met.
 *
 * Two players on the same score are separated by who had the harder draw. A bye
 * contributes nothing, because there was no opponent to be strong or weak.
 */
function buchholz(opponentIds = [], scores = {}) {
  return opponentIds.reduce((sum, id) => sum + (Number(scores[id]) || 0), 0);
}

/**
 * Median Buchholz (Buchholz Cut 1) — Buchholz with the highest and lowest
 * opponent dropped, so one freak result does not dominate the measure. Only
 * meaningful once a player has more than two opponents.
 */
function medianBuchholz(opponentIds = [], scores = {}) {
  const vals = opponentIds.map((id) => Number(scores[id]) || 0).sort((a, b) => a - b);
  const trimmed = vals.length > 2 ? vals.slice(1, -1) : vals;
  return trimmed.reduce((a, b) => a + b, 0);
}

/**
 * Sonneborn-Berger — the full score of every opponent BEATEN plus half the
 * score of every opponent DRAWN with.
 *
 * Where Buchholz asks "how strong was your draw", this asks "how strong were
 * the players you actually took points from" — beating the runner-up counts for
 * more than beating someone who lost every game.
 */
function sonnebornBerger({ beat = [], drew = [] } = {}, scores = {}) {
  const won = beat.reduce((s, id) => s + (Number(scores[id]) || 0), 0);
  const halved = drew.reduce((s, id) => s + (Number(scores[id]) || 0), 0) / 2;
  return won + halved;
}

/**
 * Order standings and assign ranks.
 *
 * Score → Buchholz → Sonneborn-Berger → wins → name. Players identical on every
 * measure genuinely share a rank rather than being split arbitrarily; they are
 * flagged `tied` so the UI can show it honestly instead of implying an order
 * that was never earned.
 *
 * @param {Array} rows each with { name, score, buchholz, sonnebornBerger, won }
 * @returns {Array} sorted copy, each row carrying `rank` and `tied`
 */
function rankStandings(rows = []) {
  const key = (r) => [
    Number(r.score) || 0,
    Number(r.buchholz) || 0,
    Number(r.sonnebornBerger) || 0,
    Number(r.won) || 0,
  ];

  const sorted = [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (kb[i] !== ka[i]) return kb[i] - ka[i];
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  let rank = 0;
  let prev = null;
  sorted.forEach((r, i) => {
    const k = key(r).join("|");
    if (k !== prev) { rank = i + 1; prev = k; }
    r.rank = rank;
  });

  // A shared rank is only meaningful if someone else holds it too.
  const counts = sorted.reduce((m, r) => { m[r.rank] = (m[r.rank] || 0) + 1; return m; }, {});
  sorted.forEach((r) => { r.tied = counts[r.rank] > 1; });

  return sorted;
}

module.exports = {
  recommendedRounds,
  maxRounds,
  pairSwissRound,
  applyRoundResults,
  buchholz,
  medianBuchholz,
  sonnebornBerger,
  rankStandings,
};
