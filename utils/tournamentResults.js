/**
 * tournamentResults — gather a normalized, render-agnostic results snapshot for
 * a tournament, covering ALL formats:
 *   - group stage         → GroupStandings
 *   - individual knockout → DirectKnockoutMatch (+ legacy KnockoutMatch)
 *   - team knockout       → TeamKnockoutMatches (+ TeamKnockoutTeams for names)
 *
 * Output is consumed by the CSV / XLSX / PDF renderers in exportController so
 * all three formats stay consistent. Every section is best-effort: a missing
 * collection or empty result simply yields an empty section, never a throw.
 *
 * Shape:
 * {
 *   tournament: { title, startDate, endDate },
 *   generatedAt: Date,
 *   groups:   [ { groupName, standings: [ {playerName, played, won, lost, drawn, scoreFor, scoreAgainst, totalPoints} ] } ],
 *   brackets: [ {
 *     sportName, kind: "individual" | "team",
 *     rounds: [ { label, rank, matches: [ {p1, p2, winner, score, status} ] } ],   // rounds ordered earliest→final
 *     podium: { champion, runnerUp, thirdPlace: [names] } | null
 *   } ],
 *   hasAnyResults: boolean
 * }
 */
const Tournament = require("../src/modules/tournaments/models/Tournament");
const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../src/modules/tournaments/models/TeamKnockoutTeams");

// DirectKnockoutMatch.round is a string enum — map to an order + a label.
const DK_ROUND_ORDER = {
  "round-of-128": 1, "round-of-64": 2, "round-of-32": 3, "round-of-16": 4,
  "round-of-8": 5, "round-of-4": 6, "quarter-final": 7, "semi-final": 8, "final": 9,
};
const DK_ROUND_LABEL = {
  "round-of-128": "Round of 128", "round-of-64": "Round of 64", "round-of-32": "Round of 32",
  "round-of-16": "Round of 16", "round-of-8": "Round of 8", "round-of-4": "Round of 4",
  "quarter-final": "Quarter-final", "semi-final": "Semi-final", "final": "Final",
};

const isFinalLabel = (l) => String(l || "").trim().toLowerCase() === "final";
const isSemiLabel = (l) => /semi[\s-]*final/i.test(String(l || ""));

function dkScore(m) {
  const fs = m.result && m.result.finalScore;
  if (fs && (fs.player1Sets || fs.player2Sets)) {
    return `${fs.player1Sets || 0}-${fs.player2Sets || 0}`;
  }
  return "";
}

function teamScore(m) {
  if (m.setsWon && (m.setsWon.home || m.setsWon.away)) {
    return `${m.setsWon.home || 0}-${m.setsWon.away || 0}`;
  }
  return "";
}

function teamRoundLabel(round, maxRound) {
  const fromTop = maxRound - round;
  if (fromTop === 0) return "Final";
  if (fromTop === 1) return "Semi-final";
  if (fromTop === 2) return "Quarter-final";
  return `Round ${round}`;
}

// Loser of a 2-player match (given the winner name); null for byes/incomplete.
function loserOf(match) {
  if (!match.winner) return null;
  return [match.p1, match.p2].find((n) => n && n !== "TBD" && n !== "BYE" && n !== match.winner) || null;
}

// Compute champion / runner-up / third place from a flat list of normalized
// matches belonging to one bracket (one sport, one engine).
function computePodium(matches) {
  if (!matches.some((m) => m.winner)) return null;

  const ranks = matches.map((m) => m.rank || 0);
  const maxRank = ranks.length ? Math.max(...ranks) : 0;

  // The final: an explicit "Final"-labelled completed match, else the highest-rank completed match.
  const finalMatch =
    matches.find((m) => isFinalLabel(m.label) && m.winner) ||
    matches.filter((m) => (m.rank || 0) === maxRank && m.winner)[0] ||
    null;
  if (!finalMatch || !finalMatch.winner) return null;

  const champion = finalMatch.winner;
  const runnerUp = loserOf(finalMatch);

  // Semi-finalists (third place, tied): losers of the semi-final round.
  let semis = matches.filter((m) => isSemiLabel(m.label) && m.winner);
  if (semis.length === 0) {
    const semiRank = (finalMatch.rank || maxRank) - 1;
    semis = matches.filter((m) => (m.rank || 0) === semiRank && m.winner);
  }
  const thirdPlace = [...new Set(semis.map(loserOf).filter(Boolean))];

  return { champion, runnerUp, thirdPlace };
}

// Group a flat list of normalized matches into ordered rounds + podium.
function buildBracket(sportName, kind, flatMatches) {
  const byLabel = new Map();
  for (const m of flatMatches) {
    if (!byLabel.has(m.label)) byLabel.set(m.label, { label: m.label, rank: m.rank || 0, matches: [] });
    byLabel.get(m.label).matches.push({ p1: m.p1, p2: m.p2, winner: m.winner, score: m.score, status: m.status });
  }
  const rounds = [...byLabel.values()].sort((a, b) => a.rank - b.rank);
  return { sportName, kind, rounds, podium: computePodium(flatMatches) };
}

async function gatherTournamentResults(tournamentId) {
  const tournament = await Tournament.findById(tournamentId)
    .select("title startDate endDate sports")
    .lean();
  if (!tournament) return null;

  // sportId → name map from the tournament definition (fallback for matches
  // that only carry sportId).
  const sportNameById = {};
  for (const s of tournament.sports || []) {
    const id = s.sportId || s.sport || s._id;
    if (id && s.sportName) sportNameById[String(id)] = s.sportName;
  }
  const resolveSport = (m) =>
    m.sportName || sportNameById[String(m.sportId)] || "Match";

  // ── Group standings ──
  let groups = [];
  try {
    const standings = await GroupStandings.find({ tournamentId }).lean();
    groups = standings.map((s) => ({
      groupName: s.groupName || "Group",
      standings: (s.standings || []).slice().sort(
        (a, b) =>
          (b.totalPoints || 0) - (a.totalPoints || 0) ||
          (b.won || 0) - (a.won || 0) ||
          (b.roundsWon || 0) - (a.roundsWon || 0)
      ),
    }));
  } catch (e) {
    console.warn("[results] group standings:", e.message);
  }

  // ── Individual knockout (DirectKnockoutMatch + legacy KnockoutMatch) ──
  const individualBySport = new Map(); // sportName → normalized matches
  const pushIndividual = (sportName, norm) => {
    if (!individualBySport.has(sportName)) individualBySport.set(sportName, []);
    individualBySport.get(sportName).push(norm);
  };

  try {
    const dk = await DirectKnockoutMatch.find({ tournamentId }).lean();
    for (const m of dk) {
      pushIndividual(resolveSport(m), {
        rank: DK_ROUND_ORDER[m.round] || m.roundNumber || 0,
        label: DK_ROUND_LABEL[m.round] || m.round || "Round",
        p1: (m.player1 && m.player1.playerName) || "TBD",
        p2: (m.player2 && m.player2.playerName) || "TBD",
        winner: (m.result && m.result.winner && m.result.winner.playerName) || null,
        score: dkScore(m),
        status: m.status || "",
      });
    }
  } catch (e) {
    console.warn("[results] direct knockout:", e.message);
  }

  try {
    const legacy = await KnockoutMatch.find({ tournamentId }).lean();
    for (const m of legacy) {
      pushIndividual(resolveSport(m), {
        rank: m.round || 0,
        label: m.roundName || `Round ${m.round || ""}`.trim(),
        p1: (m.player1 && m.player1.playerName) || "TBD",
        p2: (m.player2 && m.player2.playerName) || "TBD",
        winner: (m.winner && m.winner.playerName) || null,
        score: "",
        status: m.status || "",
      });
    }
  } catch (e) {
    console.warn("[results] legacy knockout:", e.message);
  }

  // ── Team knockout ──
  const teamBySport = new Map();
  try {
    const teamMatches = await TeamKnockoutMatches.find({ tournamentId }).lean();
    if (teamMatches.length) {
      const teams = await TeamKnockoutTeams.find({ tournamentId }).select("teamName").lean();
      const teamName = {};
      for (const t of teams) teamName[String(t._id)] = t.teamName;
      const nameOf = (id) => (id ? teamName[String(id)] || "Team" : null);

      const maxRound = Math.max(...teamMatches.map((m) => m.round || 0), 0);
      for (const m of teamMatches) {
        const sportName = m.sportName || "Team Event";
        if (!teamBySport.has(sportName)) teamBySport.set(sportName, []);
        teamBySport.get(sportName).push({
          rank: m.round || 0,
          label: teamRoundLabel(m.round || 0, maxRound),
          p1: nameOf(m.team1Id) || "TBD",
          p2: m.team2Id ? nameOf(m.team2Id) : "BYE",
          winner: nameOf(m.winnerId),
          score: teamScore(m),
          status: m.status || "",
        });
      }
    }
  } catch (e) {
    console.warn("[results] team knockout:", e.message);
  }

  // ── Assemble brackets ──
  const brackets = [];
  for (const [sportName, matches] of individualBySport) {
    brackets.push(buildBracket(sportName, "individual", matches));
  }
  for (const [sportName, matches] of teamBySport) {
    brackets.push(buildBracket(sportName, "team", matches));
  }

  const hasAnyResults =
    groups.length > 0 || brackets.some((b) => b.rounds.length > 0);

  return {
    tournament: {
      title: tournament.title || "Tournament",
      startDate: tournament.startDate || null,
      endDate: tournament.endDate || null,
    },
    generatedAt: new Date(),
    groups,
    brackets,
    hasAnyResults,
  };
}

module.exports = { gatherTournamentResults };
