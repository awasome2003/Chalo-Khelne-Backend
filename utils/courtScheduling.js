// Pure scheduling utilities for knockout bracket court + time assignment.
// Used by all three knockout-generation flows so the algorithm has a single
// source of truth (Sub-step 4 of court management).

// Default escalation when no per-round config is provided. Earlier rounds
// (anything before the SF) use Bo3 with 30/20 timing; SF jumps to Bo5 50/40;
// Final to Bo7 80/60. Mirrors the manager-facing modal defaults.
function _defaultsForRound(roundNumber, totalRounds) {
  const fromEnd = totalRounds - roundNumber; // 0 = final, 1 = SF, 2 = QF...
  if (fromEnd === 0) return { bestOf: 7, slotDurationMinutes: 80, matchDurationMinutes: 60 };
  if (fromEnd === 1) return { bestOf: 5, slotDurationMinutes: 50, matchDurationMinutes: 40 };
  return { bestOf: 3, slotDurationMinutes: 30, matchDurationMinutes: 20 };
}

// Normalize the rounds[] input. Accepts:
//   - undefined / empty array → falls back to legacy slotDurationMinutes /
//     matchDurationMinutes (fanned to every round) with cascading bestOf
//     defaults from _defaultsForRound.
//   - partial array (e.g. only round 1 supplied) → missing rounds inherit
//     defaults so callers don't have to pre-fill.
// Returns a Map<roundNumber, { bestOf, slotDurationMinutes, matchDurationMinutes }>.
function _normalizeRounds({ bracket, rounds, slotDurationMinutes, matchDurationMinutes }) {
  const totalRounds = bracket?.rounds?.length || 0;
  const map = new Map();
  const supplied = new Map();
  if (Array.isArray(rounds)) {
    for (const r of rounds) {
      if (!r || r.roundNumber == null) continue;
      supplied.set(Number(r.roundNumber), r);
    }
  }
  // Legacy single-value fan-out — when rounds[] missing or sparse, per-round
  // values come from these legacy params (one global slot/match for all rounds).
  // bestOf still cascades via _defaultsForRound.
  const legacySlot = parseInt(slotDurationMinutes, 10);
  const legacyMatch = parseInt(matchDurationMinutes, 10);
  const hasLegacy = Number.isFinite(legacySlot) && legacySlot > 0;

  for (let i = 0; i < totalRounds; i++) {
    const rn = bracket.rounds[i].roundNumber;
    const def = _defaultsForRound(rn, totalRounds);
    const s = supplied.get(rn) || {};
    let slot = parseInt(s.slotDurationMinutes, 10);
    let match = parseInt(s.matchDurationMinutes, 10);
    let bestOf = parseInt(s.bestOf, 10);

    if (!Number.isFinite(slot) || slot <= 0) {
      slot = hasLegacy ? legacySlot : def.slotDurationMinutes;
    }
    if (!Number.isFinite(match) || match <= 0) {
      match = hasLegacy && Number.isFinite(legacyMatch) && legacyMatch > 0 ? legacyMatch : def.matchDurationMinutes;
    }
    if (match > slot) match = slot;
    if (![3, 5, 7].includes(bestOf)) bestOf = def.bestOf;

    map.set(rn, { bestOf, slotDurationMinutes: slot, matchDurationMinutes: match });
  }
  return map;
}

/**
 * assignKnockoutSlots — round-aware court + time assignment for a knockout
 * bracket. Each round runs in parallel across the court pool. Round k starts
 * after round k-1's last slot ends, plus an optional inter-round break.
 *
 * Per-round slot model (introduced for flexible bestOf 3/5/7):
 *   - Each round has its own slotDurationMinutes (stride) + matchDurationMinutes
 *     (active play). Earlier rounds typically Bo3 short, finals Bo7 long.
 *   - matchEndTime  = slotStart + matchDuration_k × 60000
 *   - next slot on same court = slotStart + slotDuration_k × 60000
 *   - roundStart_k = roundStart_{k-1}
 *                  + ceil(prevRoundMatches / N) × slotDuration_{k-1}
 *                  + breakBetweenRoundsMinutes
 *
 * Backward compat: callers that still pass single slotDurationMinutes /
 * matchDurationMinutes (no rounds[]) get those values fanned to every round.
 * bestOf still cascades from defaults (Final=Bo7, SF=Bo5, earlier=Bo3) so the
 * generated matches still get a per-round matchFormat baked in.
 *
 * @param {Object}  args
 * @param {Object}  args.bracket               { rounds: [{ roundNumber, matchCount }, ...] }
 * @param {string[]} args.courtPool            Court names. Empty = legacy single-court mode.
 * @param {string?} args.legacyCourtNumber     Used when courtPool is empty. Defaults to "1".
 * @param {Date}    args.baseTime              When the FIRST round starts.
 * @param {Array?}  args.rounds                Per-round overrides:
 *                                              [{ roundNumber, bestOf, slotDurationMinutes, matchDurationMinutes }]
 *                                              Missing entries fall back to legacy params or defaults.
 * @param {number?} args.slotDurationMinutes   Legacy single value, fanned to all rounds when rounds[] sparse.
 * @param {number?} args.matchDurationMinutes  Legacy single value, fanned to all rounds when rounds[] sparse.
 * @param {number?} args.breakBetweenRoundsMinutes  Wall-clock break between rounds. Defaults to 0 (no break).
 *
 * @returns {Array<{ roundNumber, matchNumberInRound, courtNumber, matchStartTime, matchEndTime, bestOf }>}
 *   Slots in bracket-traversal order. `bestOf` rides on each slot so callers
 *   can derive matchFormat overrides without re-doing the lookup.
 */
function assignKnockoutSlots({
  bracket,
  courtPool = [],
  legacyCourtNumber = null,
  baseTime,
  rounds,
  slotDurationMinutes,
  matchDurationMinutes,
  breakBetweenRoundsMinutes,
}) {
  if (!bracket || !Array.isArray(bracket.rounds)) {
    return [];
  }

  const useCourtPool = Array.isArray(courtPool) && courtPool.length > 0;
  const N = useCourtPool ? courtPool.length : 1;
  const fallbackName = legacyCourtNumber == null ? "1" : String(legacyCourtNumber);

  let _break = parseInt(breakBetweenRoundsMinutes, 10);
  if (!Number.isFinite(_break) || _break < 0) _break = 0;
  const breakMs = _break * 60000;

  const roundCfg = _normalizeRounds({
    bracket,
    rounds,
    slotDurationMinutes,
    matchDurationMinutes,
  });

  const slots = [];
  let roundStart = new Date(baseTime);
  let prevRoundMatches = 0;
  let prevSlotMs = 0; // slot duration of round k-1, used to advance roundStart

  for (const round of bracket.rounds) {
    const cfg = roundCfg.get(round.roundNumber);
    const slotMs = cfg.slotDurationMinutes * 60000;
    const matchMs = cfg.matchDurationMinutes * 60000;

    if (prevRoundMatches > 0) {
      const slotsUsed = Math.ceil(prevRoundMatches / N);
      roundStart = new Date(roundStart.getTime() + slotsUsed * prevSlotMs + breakMs);
    }

    for (let i = 0; i < round.matchCount; i++) {
      const courtIdx = i % N;
      const positionInCourt = Math.floor(i / N);
      const courtName = useCourtPool ? courtPool[courtIdx] : fallbackName;
      const matchStartTime = new Date(
        roundStart.getTime() + positionInCourt * slotMs
      );
      const matchEndTime = new Date(matchStartTime.getTime() + matchMs);
      slots.push({
        roundNumber: round.roundNumber,
        matchNumberInRound: i + 1,
        courtNumber: courtName,
        matchStartTime,
        matchEndTime,
        bestOf: cfg.bestOf,
      });
    }

    prevRoundMatches = round.matchCount;
    prevSlotMs = slotMs;
  }

  return slots;
}

// bestOf 3 → totalSets:3, setsToWin:2;  Bo5 → 5/3;  Bo7 → 7/4. Used by the
// match factories' matchFormatOverride so per-round bestOf bakes into each
// generated match doc's matchFormat.
function bestOfToSetFormat(bestOf) {
  const n = parseInt(bestOf, 10);
  if (![3, 5, 7].includes(n)) return null;
  return { totalSets: n, setsToWin: Math.ceil(n / 2) };
}

module.exports = { assignKnockoutSlots, bestOfToSetFormat };
