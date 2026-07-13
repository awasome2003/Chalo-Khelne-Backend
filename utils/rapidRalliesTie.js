/**
 * Rapid Rallies S1 — tie assembly + completion (PURE, no DB).
 *
 * Bridges the lineup rules (rapidRalliesLineup.js) to the TeamKnockoutMatches
 * `sets[]` shape used by scoring. Two responsibilities:
 *   1. buildRapidRalliesSets() — turn two 5-slot rosters (+ optional picks)
 *      into the 5 ordered rubber documents.
 *   2. decideTieOutcome() — decide whether a tie is finished and who won,
 *      honouring `playAllSets` (all 5 rubbers always played, no dead rubbers).
 */

const { resolveRubbers } = require("./rapidRalliesLineup");

// Default placeholders before a captain has locked a dynamic pick. These keep
// the scoreboard populated; the UI forces a valid pick before the rubber is
// scored, and match completion is gated on a fully-valid selection.
const DEFAULTS = {
  home: { partner2: "P3", partner4: "P3", singles5: "P2" },
  away: { partner2: "P3", partner4: "P3", singles5: "P1" },
};

/** Build a { P1..P5 → name } map from a TeamKnockoutTeams doc's roster. */
function slotMapFromTeam(team) {
  const map = {};
  const roster = (team && team.roster) || [];
  roster.forEach((r) => {
    if (r && r.position) map[r.position] = r.name;
  });
  return map;
}

/** Build a { P1..P5 → gender } map for validation. */
function genderMapFromTeam(team) {
  const map = {};
  const roster = (team && team.roster) || [];
  roster.forEach((r) => {
    if (r && r.position) map[r.position] = { name: r.name, gender: r.gender };
  });
  return map;
}

/**
 * Assemble the 5 rubber (`set`) documents for a Rapid Rallies tie.
 *
 * @param {object} homeSlotMap { P1..P5 → name } for the home team
 * @param {object} awaySlotMap { P1..P5 → name } for the away team
 * @param {object} [homeSel]   { partner2, partner4, singles5 } (slots) — home picks
 * @param {object} [awaySel]   away picks
 * @returns {Array} set docs ready for TeamKnockoutMatches.sets
 */
function buildRapidRalliesSets(homeSlotMap, awaySlotMap, homeSel = {}, awaySel = {}) {
  const hSel = { ...DEFAULTS.home, ...clean(homeSel) };
  const aSel = { ...DEFAULTS.away, ...clean(awaySel) };
  const rubbers = resolveRubbers(hSel, aSel);

  const REQUIRES_SELECTION = new Set([2, 4, 5]);

  return rubbers.map((rb) => {
    const homeNames = rb.homeSlots.map((s) => homeSlotMap[s] || null);
    const awayNames = rb.awaySlots.map((s) => awaySlotMap[s] || null);
    const isDoubles = rb.type === "doubles";
    const typeLabel = isDoubles
      ? `Doubles ${rb.homeSlots.join("")}-${rb.awaySlots.join("")}`
      : `Singles ${rb.homeSlots[0]}-${rb.awaySlots[0]}`;

    return {
      setNumber: rb.setNumber,
      type: typeLabel,
      homePlayer: homeNames[0] || null,
      awayPlayer: awayNames[0] || null,
      homePlayerB: isDoubles ? homeNames[1] || null : null,
      awayPlayerB: isDoubles ? awayNames[1] || null : null,
      selectionId: REQUIRES_SELECTION.has(rb.setNumber) ? null : undefined,
      status: "PENDING",
      games: [],
      gamesWon: { home: 0, away: 0 },
      setWinner: null,
    };
  });
}

function clean(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k]) out[k] = obj[k];
  });
  return out;
}

/**
 * Decide whether a team tie is complete and who won.
 *
 * @param {object} p
 * @param {Array}  p.sets       — the tie's sets (each with .setWinner, .status)
 * @param {number} p.setsToWin  — rubbers needed to win (used when !playAllSets)
 * @param {boolean} p.playAllSets — if true, tie ends only when ALL rubbers done
 * @returns {{complete:boolean, winner:('home'|'away'|null), homeWon:number, awayWon:number}}
 */
function decideTieOutcome({ sets, setsToWin, playAllSets }) {
  const list = sets || [];
  const homeWon = list.filter((s) => s.setWinner === "home").length;
  const awayWon = list.filter((s) => s.setWinner === "away").length;

  let complete;
  if (playAllSets) {
    complete = list.length > 0 && list.every((s) => s.status === "COMPLETED");
  } else {
    complete = homeWon >= setsToWin || awayWon >= setsToWin;
  }

  const winner = complete
    ? homeWon > awayWon
      ? "home"
      : awayWon > homeWon
      ? "away"
      : null
    : null;

  return { complete, winner, homeWon, awayWon };
}

module.exports = {
  slotMapFromTeam,
  genderMapFromTeam,
  buildRapidRalliesSets,
  decideTieOutcome,
};
