/**
 * Event ⇄ Tournament bridge.  "Create Event = Create Tournament":
 * when an agency event has sports, we spin up a real Tournament (the scoring
 * engine) and link it via AgencyEvent.linkedTournamentId — so the event gets
 * fixtures, groups, knockouts and live scoring from the existing engine.
 */
const Tournament = require("../tournaments/models/Tournament");
const Sport = require("../catalog/models/Sport");

// Resolve the engine scoring type for a sport (independent of the Sport doc's
// long-form label — the match engine uses: sets/innings/board/single/time).
function shortScoringType(sport) {
  const name = (sport.name || "").toLowerCase();
  if (name.includes("carrom")) return "board";
  const st = (sport.scoringType || "").toLowerCase();
  if (st.startsWith("innings")) return "innings";
  if (st.startsWith("halves") || st.startsWith("quarters")) return "time";
  if (st.startsWith("single")) return "single";
  return "sets"; // sets-games-points / custom fallback
}

// Sensible default match format per scoring type (the shapes verified across
// the scoring regression + seeds).
function buildMatchFormat(short, name, fee) {
  const n = (name || "").toLowerCase();
  switch (short) {
    case "innings":
      return { scoringType: "innings", oversCount: 20, inningsCount: 2, superOver: true, totalSets: 2, setsToWin: 1, formatVersion: 1 };
    case "time":
      return { scoringType: "time", halvesCount: 2, halvesDuration: 45, totalSets: 1, setsToWin: 1, formatVersion: 1 };
    case "board":
      return { scoringType: "board", boardsToWin: 2, pointsPerBoard: 25, queenValue: 3, totalSets: 3, setsToWin: 2, formatVersion: 1 };
    case "single":
      return { scoringType: "single", totalSets: 1, setsToWin: 1, formatVersion: 1 };
    default: { // sets
      if (n.includes("foosball"))
        return { scoringType: "sets", totalSets: 1, setsToWin: 1, totalGames: 1, gamesToWin: 1, pointsToWinGame: 10, marginToWin: 1, deuceRule: false, formatVersion: 1 };
      const pts = (n.includes("table tennis") || n.includes("pickleball")) ? 11 : 21;
      return { scoringType: "sets", totalSets: 3, setsToWin: 2, totalGames: 3, gamesToWin: 2, pointsToWinGame: pts, marginToWin: 2, deuceRule: true, maxPointsCap: pts === 21 ? 30 : null, formatVersion: 1 };
    }
  }
}

/**
 * Build + save a Tournament for an AgencyEvent. Returns the tournament, or null
 * if the event has no resolvable sports. Throws on save failure (caller decides).
 * agencyId owns it (managerId + clubId), so it stays inside the agency's scope.
 */
async function createTournamentForEvent(event, agencyId, organizerName) {
  const names = Array.isArray(event.sports) ? event.sports : [];
  const sportEntries = [];
  for (const sportName of names) {
    const sport = await Sport.findOne({ name: sportName }).lean();
    if (!sport) continue; // skip unknown sport names
    const short = shortScoringType(sport);
    sportEntries.push({
      matchFormat: buildMatchFormat(short, sport.name, event.registrationFee),
      sportRules: null,
      stageConfig: {
        qualifierKnockout: { enabled: false, completed: false },
        mainKnockout: { enabled: false, completed: false },
        groupStage: { completed: false },
        round2Format: null,
      },
      sportId: sport._id,
      sportName: sport.name,
      sportSlug: sport.slug,
      type: "group stage",
      categories: [{ templateId: null, name: "Open", fee: event.registrationFee || 0, minAge: null, maxAge: null, gender: "any" }],
      groupStageFormat: sport.isTeamSport ? "Teams" : "Singles",
      knockoutFormat: null,
      davisCupFormatId: null,
      qualifyPerGroup: 2,
      drawSize: null,
      tournamentLevel: "unranked",
      currentStage: "registration",
    });
  }
  if (!sportEntries.length) return null;

  const t = new Tournament({
    title: event.name,
    description: `Auto-created from IONIX Event OS event "${event.name}".`,
    selectedTime: { startTime: event.time || "", endTime: "" },
    startDate: event.date || "",
    endDate: event.date || "",
    organizerName: organizerName || "IONIX Sports Events",
    eventLocation: event.venue ? [event.venue] : [],
    managerId: [agencyId],
    clubId: agencyId,           // tenant key = the agency
    sports: sportEntries,
    turfs: [],
    isPrivate: false,
    tournamentLevel: "unranked",
    registrationDeadline: null,
  });
  await t.save();
  return t;
}

module.exports = { createTournamentForEvent, shortScoringType, buildMatchFormat };
