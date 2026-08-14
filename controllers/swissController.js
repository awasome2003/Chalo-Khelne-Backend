"use strict";
/**
 * Swiss-system events.
 *
 * A fixed number of rounds, nobody eliminated, standings decide the result.
 * Rounds are generated ONE AT A TIME — round N's pairings depend on round
 * N-1's results, so unlike a group stage the fixtures cannot be produced up
 * front.
 *
 * DESIGN NOTE — pairing state is rebuilt from the match documents on every
 * request, never stored. It would be cheaper to keep a running tally, but then
 * correcting a result (reopening a match, fixing a mistyped score) would leave
 * the tally stale and silently poison every subsequent pairing. Deriving it
 * means a correction is picked up automatically.
 */
const SwissMatch = require("../src/modules/tournaments/models/SwissMatch");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const { createSwissMatch } = require("../factories/MatchFactory");
const {
  pairSwissRound,
  applyRoundResults,
  recommendedRounds,
  maxRounds,
  buchholz,
  medianBuchholz,
  sonnebornBerger,
  rankStandings,
} = require("../utils/swissPairing");
const { assignKnockoutSlots } = require("../utils/courtScheduling");
const { assertSportInTournament, handleSportContextError } = require("../middleware/requireSportContext");

// ── Scoping ────────────────────────────────────────────────────────────────
// One event = (tournament, sport, category). Mirrors direct knockout, so a
// tournament can run several independent Swiss events side by side.

const normalizeCategory = (raw) => {
  const v = (raw == null ? "" : String(raw)).trim();
  if (!v || v.toUpperCase() === "ALL") return null;
  return v;
};

const eventFilter = (tournamentId, sportId, category) => {
  const f = { tournamentId };
  if (sportId) f.sportId = sportId;
  if (category) f.category = category;
  return f;
};

// ── Entrant identity ───────────────────────────────────────────────────────
// Guest/corporate entrants have no user account, so playerId is null and the
// name is the only identity. Every id used by the pairing algorithm goes
// through here so the two kinds never mix.
const entrantId = (p) =>
  p?.playerId ? String(p.playerId) : `name:${(p?.userName || p?.playerName || "").trim()}`;

/**
 * Was this completed match drawn?
 *
 * Two shapes mean "drawn", because two engines write it:
 *   • result.isDraw === true — what SwissMatch declares and the factory writes.
 *   • a winner object that names nobody — what the shared live scorer writes
 *     for a genuine group-stage draw in a time or single sport (Football,
 *     Chess): it CLEARS the winner to { playerId: null, playerName: null }
 *     rather than setting a flag.
 *
 * That second shape is the trap: the object is truthy, so a naive check reads
 * it as a winner and derives the id "name:" — a phantom entrant matching
 * nobody, which scored the draw as a LOSS for both players.
 */
const isDrawnResult = (result) => {
  if (!result) return false;
  if (result.isDraw === true) return true;
  const w = result.winner;
  const named = !!(w && (w.playerId || String(w.playerName || "").trim()));
  return !named;
};

/** The winning entrant's id, or null when the match was drawn. */
const winnerIdOf = (result) => {
  if (isDrawnResult(result)) return null;
  const w = result.winner;
  return w.playerId ? String(w.playerId) : `name:${String(w.playerName || "").trim()}`;
};

// ── Rebuild pairing state from stored matches ──────────────────────────────

/**
 * Fold every completed round back into { scores, opponents, byes }.
 *
 * Incomplete matches are skipped rather than guessed at — a round still being
 * played simply contributes nothing yet.
 */
function buildPairingState(matches) {
  const rounds = [...new Set(matches.map((m) => m.swissRound))].sort((a, b) => a - b);
  let state = { scores: {}, opponents: {}, byes: {} };

  for (const round of rounds) {
    const inRound = matches.filter((m) => m.swissRound === round);
    const results = [];
    let byeId = null;

    for (const m of inRound) {
      if (m.isBye) {
        byeId = entrantId(m.player1);
        continue;
      }
      if (String(m.status).toUpperCase() !== "COMPLETED") continue;

      results.push({
        player1Id: entrantId(m.player1),
        player2Id: entrantId(m.player2),
        winnerId: winnerIdOf(m.result),
      });
    }

    state = applyRoundResults(state, results, byeId);
  }

  return state;
}

/** The distinct entrants of an event, recovered from its round-1 matches. */
function entrantsFromMatches(matches) {
  const byId = new Map();
  const add = (p, seed) => {
    if (!p || (!p.playerId && !p.userName)) return;
    const id = entrantId(p);
    if (!byId.has(id)) {
      byId.set(id, { id, name: p.userName, playerId: p.playerId || null, seed });
    }
  };
  // Round 1 contains every entrant exactly once.
  const first = matches.filter((m) => m.swissRound === 1);
  let seed = 1;
  for (const m of first) {
    add(m.player1, seed++);
    if (!m.isBye) add(m.player2, seed++);
  }
  return [...byId.values()];
}

// ── Standings ──────────────────────────────────────────────────────────────

/**
 * Standings for an event. Score is the pairing score (win 1, draw 0.5, bye 1);
 * played/won/lost/drawn count actual matches, so a bye does not inflate them.
 *
 * Ranking is score → Buchholz → Sonneborn-Berger → wins → name. Score alone is
 * not enough: over 5 rounds a 32-player field reliably leaves several players
 * level, and the tiebreaks are what make the order defensible when a
 * participant asks why they finished below someone on the same points.
 */
function computeStandings(matches) {
  const entrants = entrantsFromMatches(matches);
  const state = buildPairingState(matches);

  const rows = entrants.map((e) => {
    let played = 0, won = 0, lost = 0, drawn = 0, byes = 0;
    const beat = [];
    const drew = [];

    for (const m of matches) {
      if (String(m.status).toUpperCase() !== "COMPLETED") continue;

      if (m.isBye) {
        if (entrantId(m.player1) === e.id) byes += 1;
        continue;
      }
      const p1 = entrantId(m.player1);
      const p2 = entrantId(m.player2);
      if (p1 !== e.id && p2 !== e.id) continue;

      const opponent = p1 === e.id ? p2 : p1;
      played += 1;

      const wid = winnerIdOf(m.result);
      if (wid === null) {
        drawn += 1;
        drew.push(opponent);
        continue;
      }
      if (wid === e.id) { won += 1; beat.push(opponent); }
      else lost += 1;
    }

    const opponents = state.opponents[e.id] || [];
    return {
      id: e.id,
      playerId: e.playerId,
      name: e.name,
      score: state.scores[e.id] || 0,
      played, won, lost, drawn, byes,
      opponents,
      buchholz: buchholz(opponents, state.scores),
      medianBuchholz: medianBuchholz(opponents, state.scores),
      sonnebornBerger: sonnebornBerger({ beat, drew }, state.scores),
    };
  });

  return rankStandings(rows);
}

// ── Scheduling ─────────────────────────────────────────────────────────────

/**
 * Court + time for one round. Reuses the shared knockout scheduler by handing
 * it a single-round bracket, so Swiss and knockout schedule identically rather
 * than growing a second implementation.
 */
function scheduleRound({ matchCount, tournament, sportId, req, baseTime }) {
  const bodyCourtCount = parseInt(req.body?.courtCount, 10);
  let courtPool;
  if (Number.isFinite(bodyCourtCount) && bodyCourtCount > 0) {
    courtPool = Array.from({ length: bodyCourtCount }, (_, i) => String(i + 1));
  } else {
    courtPool = (tournament.courts || [])
      .filter((c) => c.isActive !== false)
      .filter((c) => !c.sportId || String(c.sportId) === String(sportId))
      .map((c) => c.name);
  }

  const dur = Number(req.body?.matchDurationMinutes);
  const gap = Number(req.body?.gapMinutes);
  const matchDurationMinutes = Number.isFinite(dur) && dur > 0 ? dur : 30;
  const gapMinutes = Number.isFinite(gap) && gap >= 0 ? gap : 10;

  return assignKnockoutSlots({
    bracket: { rounds: [{ roundNumber: 1, matchCount }] },
    courtPool,
    legacyCourtNumber: req.body?.courtNumber,
    baseTime,
    rounds: [{
      roundNumber: 1,
      slotDurationMinutes: matchDurationMinutes + gapMinutes,
      matchDurationMinutes,
    }],
    breakBetweenRoundsMinutes: 0,
  });
}

/** Turn pairings into documents and persist them. */
async function persistRound({ pairings, bye, roundNumber, totalRounds, tournament, tournamentId, sportId, category, slots }) {
  const docs = [];
  let i = 0;

  for (const { player1, player2 } of pairings) {
    const slot = slots[i] || {};
    docs.push(createSwissMatch({
      tournament,
      tournamentId,
      sportId,
      category,
      swissRound: roundNumber,
      totalRounds,
      matchNumber: i + 1,
      player1: { playerId: player1.playerId || null, userName: player1.name },
      player2: { playerId: player2.playerId || null, userName: player2.name },
      courtNumber: slot.courtNumber,
      matchStartTime: slot.matchStartTime,
      matchEndTime: slot.matchEndTime,
    }));
    i++;
  }

  if (bye) {
    docs.push(createSwissMatch({
      tournament,
      tournamentId,
      sportId,
      category,
      swissRound: roundNumber,
      totalRounds,
      matchNumber: i + 1,
      player1: { playerId: bye.playerId || null, userName: bye.name },
      isBye: true,
    }));
  }

  return SwissMatch.insertMany(docs);
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * Start an event: validate, then generate round 1.
 * POST /swiss/:tournamentId/start
 */
const startSwissEvent = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sportId, players, rounds, randomFirstRound } = req.body || {};
    const category = normalizeCategory(req.body?.category);

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    try {
      assertSportInTournament(sportId, tournament);
    } catch (err) {
      if (handleSportContextError(err, res)) return;
      throw err;
    }

    if (!Array.isArray(players) || players.length < 2) {
      return res.status(400).json({ success: false, message: "At least 2 players are required." });
    }

    // Duplicate entrants would break pairing — the same person cannot be given
    // two records — so reject rather than silently de-duplicating a field the
    // manager believes is complete.
    const normalized = players.map((p, i) => ({
      id: entrantId(p),
      name: p.userName || p.playerName || p.name || `Player ${i + 1}`,
      playerId: p.playerId || p._id || null,
      seed: Number.isFinite(Number(p.seed)) ? Number(p.seed) : i + 1,
    }));
    if (new Set(normalized.map((p) => p.id)).size !== normalized.length) {
      return res.status(400).json({ success: false, message: "The player list contains duplicates." });
    }

    const totalRounds = Number(rounds);
    const cap = maxRounds(normalized.length);
    if (!Number.isFinite(totalRounds) || totalRounds < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of rounds is required.",
        recommendedRounds: recommendedRounds(normalized.length),
        maxRounds: cap,
      });
    }
    if (totalRounds > cap) {
      // Beyond n-1 rounds a repeat pairing is unavoidable — the event has
      // become a round robin and cannot continue as Swiss.
      return res.status(400).json({
        success: false,
        message: `${normalized.length} players support at most ${cap} rounds without repeating a fixture.`,
        recommendedRounds: recommendedRounds(normalized.length),
        maxRounds: cap,
      });
    }

    const scope = eventFilter(tournamentId, sportId, category);
    if (await SwissMatch.countDocuments(scope) > 0) {
      return res.status(409).json({
        success: false,
        message: "A Swiss event already exists for this sport/category. Reset it first.",
      });
    }

    const { pairings, bye, exhausted } = pairSwissRound({
      players: normalized,
      round: 1,
      randomFirstRound: randomFirstRound === true,
      shuffle: (arr) => [...arr].sort(() => Math.random() - 0.5),
    });
    if (exhausted) {
      return res.status(400).json({ success: false, message: "Could not pair round 1." });
    }

    const baseTime = req.body?.startTime ? new Date(req.body.startTime) : new Date();
    const slots = scheduleRound({
      matchCount: pairings.length, tournament, sportId, req,
      baseTime: isNaN(baseTime.getTime()) ? new Date() : baseTime,
    });

    const saved = await persistRound({
      pairings, bye, roundNumber: 1, totalRounds,
      tournament, tournamentId, sportId, category, slots,
    });

    return res.status(201).json({
      success: true,
      message: `Swiss event started — round 1 of ${totalRounds} generated.`,
      round: 1,
      totalRounds,
      playerCount: normalized.length,
      matches: saved,
    });
  } catch (err) {
    console.error("[SWISS_START] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Generate the next round from the results so far.
 * POST /swiss/:tournamentId/next-round
 */
const generateNextRound = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.body?.sportId || req.query?.sportId || null;
    const category = normalizeCategory(req.body?.category ?? req.query?.category);
    const scope = eventFilter(tournamentId, sportId, category);

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const matches = await SwissMatch.find(scope);
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: "No Swiss event found for this sport/category." });
    }

    const totalRounds = matches[0].totalRounds;
    const currentRound = Math.max(...matches.map((m) => m.swissRound));

    if (currentRound >= totalRounds) {
      return res.status(400).json({
        success: false,
        complete: true,
        message: `All ${totalRounds} rounds have been generated. The standings are final.`,
      });
    }

    // Round N cannot be paired until round N-1 is decided — the pairings depend
    // on those results.
    const pending = matches.filter(
      (m) => m.swissRound === currentRound && String(m.status).toUpperCase() !== "COMPLETED"
    );
    if (pending.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Round ${currentRound} has ${pending.length} match(es) still to be played.`,
        pending: pending.map((m) => ({
          matchId: String(m._id),
          player1: m.player1?.userName,
          player2: m.player2?.userName,
        })),
      });
    }

    const entrants = entrantsFromMatches(matches);
    const state = buildPairingState(matches);
    const nextRound = currentRound + 1;

    const { pairings, bye, exhausted } = pairSwissRound({
      players: entrants, round: nextRound, ...state,
    });
    if (exhausted) {
      return res.status(400).json({
        success: false,
        exhausted: true,
        message:
          "Every remaining pairing has already been played — this field cannot support another round. " +
          "End the event on the current standings.",
      });
    }

    const lastEnd = matches
      .filter((m) => m.swissRound === currentRound && m.matchEndTime)
      .map((m) => new Date(m.matchEndTime).getTime());
    const baseTime = req.body?.startTime
      ? new Date(req.body.startTime)
      : new Date((lastEnd.length ? Math.max(...lastEnd) : Date.now()) + 10 * 60000);

    const slots = scheduleRound({
      matchCount: pairings.length, tournament, sportId, req,
      baseTime: isNaN(baseTime.getTime()) ? new Date() : baseTime,
    });

    const saved = await persistRound({
      pairings, bye, roundNumber: nextRound, totalRounds,
      tournament, tournamentId, sportId, category, slots,
    });

    return res.status(201).json({
      success: true,
      message: `Round ${nextRound} of ${totalRounds} generated.`,
      round: nextRound,
      totalRounds,
      matches: saved,
    });
  } catch (err) {
    console.error("[SWISS_NEXT_ROUND] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * The whole event: rounds, standings and what the manager can do next.
 * GET /swiss/:tournamentId
 */
const getSwissEvent = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.query?.sportId || null;
    const category = normalizeCategory(req.query?.category);

    const matches = await SwissMatch.find(eventFilter(tournamentId, sportId, category))
      .sort({ swissRound: 1, matchNumber: 1 })
      .lean();

    if (matches.length === 0) {
      return res.json({ success: true, exists: false, rounds: [], standings: [] });
    }

    const totalRounds = matches[0].totalRounds;
    const currentRound = Math.max(...matches.map((m) => m.swissRound));
    const roundComplete = matches
      .filter((m) => m.swissRound === currentRound)
      .every((m) => String(m.status).toUpperCase() === "COMPLETED");

    const byRound = [];
    for (let r = 1; r <= currentRound; r++) {
      const inRound = matches.filter((m) => m.swissRound === r);
      byRound.push({
        round: r,
        complete: inRound.every((m) => String(m.status).toUpperCase() === "COMPLETED"),
        matches: inRound,
      });
    }

    return res.json({
      success: true,
      exists: true,
      totalRounds,
      currentRound,
      isFinalRound: currentRound >= totalRounds,
      canGenerateNextRound: roundComplete && currentRound < totalRounds,
      rounds: byRound,
      standings: computeStandings(matches),
    });
  } catch (err) {
    console.error("[SWISS_GET] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Delete an event. Scoped to (sport, category) so resetting one never destroys
 * another running alongside it.
 * DELETE /swiss/:tournamentId
 */
const resetSwissEvent = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.query?.sportId || req.body?.sportId || null;
    const category = normalizeCategory(req.query?.category ?? req.body?.category);

    const deleted = await SwissMatch.deleteMany(eventFilter(tournamentId, sportId, category));
    return res.json({ success: true, message: `Deleted ${deleted.deletedCount} matches.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  startSwissEvent,
  generateNextRound,
  getSwissEvent,
  resetSwissEvent,
  // Exported for tests and for the UI's round-count suggestion.
  computeStandings,
  buildPairingState,
};
