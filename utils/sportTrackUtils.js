// server/utils/sportTrackUtils.js
//
// Helpers for accessing per-sport configuration on a Tournament.
// Tournaments store their per-sport state in `tournament.sports[]`.
//
// STEP 17d — synthesizeLegacyTrack DELETED. Every Tournament has
// sports[] populated post-STEP-16; helpers no longer fall back to
// root scalars. Callers receive null/[]/{} when sports[] is missing
// and apply their own display defaults.

// Find a sport-track on a tournament. Returns null when sports[] is
// missing/empty. When sportId is omitted on a multi-sport tournament,
// returns the first track (callers should provide sportId for correctness).
function getSportTrack(tournament, sportId) {
  if (!tournament) return null;
  const tracks = Array.isArray(tournament.sports) ? tournament.sports : [];
  if (tracks.length === 0) return null;
  if (!sportId) return tracks[0];
  const sportIdStr = String(sportId);
  return tracks.find((t) => String(t.sportId) === sportIdStr) || null;
}

// All sport tracks. Returns [] when sports[] is missing.
function listSportTracks(tournament) {
  if (!tournament) return [];
  return Array.isArray(tournament.sports) ? tournament.sports : [];
}

// Get the active stage for a specific sport on a tournament.
function getCurrentStage(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.currentStage || "registration";
}

// Update currentStage for a specific sport. Falls back to root scalar for
// legacy tournaments. Lazy-requires Tournament to avoid circular imports.
async function setCurrentStage(tournamentId, sportId, stage) {
  const Tournament = require("../Modal/Tournament");
  if (!sportId) {
    return Tournament.findByIdAndUpdate(
      tournamentId,
      { currentStage: stage },
      { new: true }
    );
  }
  return Tournament.findOneAndUpdate(
    { _id: tournamentId, "sports.sportId": sportId },
    { $set: { "sports.$.currentStage": stage } },
    { new: true }
  );
}

// Update a stageConfig dot-path on a specific sport-track. `path` is
// relative to stageConfig (e.g., "qualifierKnockout.enabled").
async function setStageConfigPath(tournamentId, sportId, path, value) {
  const Tournament = require("../Modal/Tournament");
  if (!sportId) {
    return Tournament.findByIdAndUpdate(
      tournamentId,
      { $set: { [`stageConfig.${path}`]: value } },
      { new: true }
    );
  }
  return Tournament.findOneAndUpdate(
    { _id: tournamentId, "sports.sportId": sportId },
    { $set: { [`sports.$.stageConfig.${path}`]: value } },
    { new: true }
  );
}

// Get matchFormat for a specific sport-track. Falls back to root scalar.
function getMatchFormat(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.matchFormat || null;
}

// Resolved sportName for a specific track.
// STEP 17d — legacy `tournament.sportsType` fallback removed.
function getSportName(tournament, sportId) {
  return getSportTrack(tournament, sportId)?.sportName || null;
}

// STEP 17b.i — per-sport readers for fields that used to live on the
// Tournament root. All resolve via getSportTrack so they inherit the
// legacy-fallback path until 17d removes synthesizeLegacyTrack.
function getTournamentType(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.type || null;
}
function getCategories(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return Array.isArray(track?.categories) ? track.categories : [];
}
function getQualifyPerGroup(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.qualifyPerGroup ?? 2;
}
function getDrawSize(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.drawSize ?? null;
}
function getGroupStageFormat(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.groupStageFormat || null;
}
function getKnockoutFormat(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.knockoutFormat || null;
}
function getDavisCupFormatId(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.davisCupFormatId || null;
}
function getSportRules(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  return track?.sportRules || null;
}
function getStageConfig(tournament, sportId) {
  const track = getSportTrack(tournament, sportId);
  if (!track) return {};
  return track.stageConfig?.toObject?.() || track.stageConfig || {};
}

// Resolve which sportId to stamp on a new doc. Same fallback chain
// MatchFactory's _stamp uses, exposed for non-factory callers (controllers
// writing TopPlayers, BookingGroup, GroupStandings, SuperPlayers, etc.):
// explicit > tournament.sports[0].sportId > null.
function resolveSportId(tournament, providedSportId) {
  if (providedSportId) return providedSportId;
  return tournament?.sports?.[0]?.sportId || null;
}

module.exports = {
  getSportTrack,
  listSportTracks,
  getCurrentStage,
  setCurrentStage,
  setStageConfigPath,
  getMatchFormat,
  getSportName,
  resolveSportId,
  getTournamentType,
  getCategories,
  getQualifyPerGroup,
  getDrawSize,
  getGroupStageFormat,
  getKnockoutFormat,
  getDavisCupFormatId,
  getSportRules,
  getStageConfig,
};
