// Court / table catalog CRUD for the tournament-level court pool.
//
// Sub-step 1 of the court-management feature. v1 stores all courts at
// `sportId: null` (tournament-wide pool). The schema is already per-sport
// capable — v2 will surface a "Assign to sport" UI without migration.
//
// Soft-delete only (isActive: false). Past match assignments survive on
// renamed/disabled courts because match.courtNumber stores the name string,
// not an ObjectId reference (see Open Q1 + Q10 in the plan).

const mongoose = require("mongoose");
const Tournament = require("../src/modules/tournaments/models/Tournament");

// Helper — returns 400 + early-exit when tournamentId is malformed.
function _validTournamentId(req, res) {
  const { tournamentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
    res.status(400).json({ success: false, message: "Invalid tournamentId" });
    return null;
  }
  return tournamentId;
}

// Optional sportId scope filter for the LIST endpoint. When `?sportId=`
// is passed, return courts that match that sport OR are tournament-wide
// (sportId: null). Without the param, return everything.
function _filterBySport(courts, sportIdParam) {
  if (!sportIdParam) return courts;
  if (!mongoose.Types.ObjectId.isValid(sportIdParam)) return courts;
  const sid = String(sportIdParam);
  return courts.filter((c) => {
    if (!c.sportId) return true; // tournament-wide pool
    return String(c.sportId) === sid;
  });
}

// GET /api/tournaments/:tournamentId/courts
//   Optional ?sportId=...&includeInactive=true
exports.listCourts = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const tournament = await Tournament.findById(tournamentId).select("courts").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    let courts = tournament.courts || [];
    if (!includeInactive) courts = courts.filter((c) => c.isActive !== false);
    courts = _filterBySport(courts, req.query.sportId);

    return res.status(200).json({ success: true, courts });
  } catch (err) {
    console.error("[COURTS] listCourts error:", err);
    return res.status(500).json({ success: false, message: "Failed to list courts", error: err.message });
  }
};

// POST /api/tournaments/:tournamentId/courts
//   Body: { name (required), type?, sportId? }
exports.createCourt = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const { name, type = null, sportId = null } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Court name is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    // Sport validation when sportId is provided. Must reference an existing
    // sport on this tournament. v1 typically passes null (tournament-wide).
    if (sportId) {
      if (!mongoose.Types.ObjectId.isValid(sportId)) {
        return res.status(400).json({ success: false, message: "Invalid sportId" });
      }
      const sportExists = (tournament.sports || []).some((s) => String(s.sportId) === String(sportId));
      if (!sportExists) {
        return res.status(400).json({ success: false, message: "sportId does not belong to this tournament" });
      }
    }

    // Reject duplicate active-court names within the same scope (case-insensitive).
    // Inactive courts are ignored — a manager can re-add a name that was retired.
    const trimmedName = String(name).trim();
    const lowerName = trimmedName.toLowerCase();
    const dup = (tournament.courts || []).some((c) => {
      if (c.isActive === false) return false;
      if (String(c.sportId || "") !== String(sportId || "")) return false;
      return String(c.name || "").trim().toLowerCase() === lowerName;
    });
    if (dup) {
      return res.status(409).json({
        success: false,
        message: `An active court named "${trimmedName}" already exists in this scope.`,
      });
    }

    const newCourt = {
      name: trimmedName,
      type: type ? String(type) : null,
      sportId: sportId || null,
      isActive: true,
      createdAt: new Date(),
    };
    tournament.courts.push(newCourt);
    await tournament.save({ validateModifiedOnly: true });

    // Return the newly-created subdoc (Mongoose assigned the _id).
    const created = tournament.courts[tournament.courts.length - 1];
    return res.status(201).json({ success: true, court: created });
  } catch (err) {
    console.error("[COURTS] createCourt error:", err);
    return res.status(500).json({ success: false, message: "Failed to create court", error: err.message });
  }
};

// POST /api/tournaments/:tournamentId/courts/bulk
//   Body: { courts: [{ name, type? }, ...], sportId? }
//   Bulk-creates courts. Trims and dedupes within the batch (case-insensitive,
//   first occurrence wins). Skips rows that collide with an active court of
//   the same name in the same scope. Returns { created, skipped } so the
//   client can surface partial-success feedback.
exports.bulkCreateCourts = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const { courts: input = [], sportId = null } = req.body || {};
    if (!Array.isArray(input) || input.length === 0) {
      return res.status(400).json({ success: false, message: "courts array is required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    if (sportId) {
      if (!mongoose.Types.ObjectId.isValid(sportId)) {
        return res.status(400).json({ success: false, message: "Invalid sportId" });
      }
      const sportExists = (tournament.sports || []).some((s) => String(s.sportId) === String(sportId));
      if (!sportExists) {
        return res.status(400).json({ success: false, message: "sportId does not belong to this tournament" });
      }
    }

    const existingActiveLowerNames = new Set(
      (tournament.courts || [])
        .filter((c) => c.isActive !== false && String(c.sportId || "") === String(sportId || ""))
        .map((c) => String(c.name || "").trim().toLowerCase())
    );

    const seenInBatch = new Set();
    const created = [];
    const skipped = [];

    for (const raw of input) {
      const rawName = raw && typeof raw === "object" ? raw.name : raw;
      const trimmedName = String(rawName || "").trim();
      if (!trimmedName) {
        skipped.push({ name: rawName, reason: "empty name" });
        continue;
      }
      const lowerName = trimmedName.toLowerCase();
      if (seenInBatch.has(lowerName)) {
        skipped.push({ name: trimmedName, reason: "duplicate within batch" });
        continue;
      }
      if (existingActiveLowerNames.has(lowerName)) {
        skipped.push({ name: trimmedName, reason: "already exists" });
        continue;
      }
      seenInBatch.add(lowerName);

      const type = raw && typeof raw === "object" && raw.type ? String(raw.type) : null;
      const newCourt = {
        name: trimmedName,
        type,
        sportId: sportId || null,
        isActive: true,
        createdAt: new Date(),
      };
      tournament.courts.push(newCourt);
      created.push(tournament.courts[tournament.courts.length - 1]);
    }

    if (created.length > 0) {
      await tournament.save({ validateModifiedOnly: true });
    }

    return res.status(201).json({ success: true, created, skipped });
  } catch (err) {
    console.error("[COURTS] bulkCreateCourts error:", err);
    return res.status(500).json({ success: false, message: "Failed to bulk-create courts", error: err.message });
  }
};

// PUT /api/tournaments/:tournamentId/courts/:courtId
//   Body: any of { name, type, sportId, isActive }. Only provided fields are updated.
exports.updateCourt = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const { courtId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(courtId)) {
      return res.status(400).json({ success: false, message: "Invalid courtId" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const court = tournament.courts.id(courtId);
    if (!court) {
      return res.status(404).json({ success: false, message: "Court not found on this tournament" });
    }

    const { name, type, sportId, isActive } = req.body || {};

    // Validate sportId when changed.
    if (sportId !== undefined && sportId !== null) {
      if (!mongoose.Types.ObjectId.isValid(sportId)) {
        return res.status(400).json({ success: false, message: "Invalid sportId" });
      }
      const sportExists = (tournament.sports || []).some((s) => String(s.sportId) === String(sportId));
      if (!sportExists) {
        return res.status(400).json({ success: false, message: "sportId does not belong to this tournament" });
      }
    }

    // Validate rename — reject collision with another active court in the
    // same scope. Self-collision (renaming to the same name) is allowed.
    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: "Court name cannot be empty" });
      }
      const newScopeSportId = sportId !== undefined ? sportId : court.sportId;
      const lowerName = trimmedName.toLowerCase();
      const dup = (tournament.courts || []).some((c) => {
        if (String(c._id) === String(courtId)) return false;
        if (c.isActive === false) return false;
        if (String(c.sportId || "") !== String(newScopeSportId || "")) return false;
        return String(c.name || "").trim().toLowerCase() === lowerName;
      });
      if (dup) {
        return res.status(409).json({
          success: false,
          message: `Another active court named "${trimmedName}" already exists in this scope.`,
        });
      }
      court.name = trimmedName;
    }

    if (type !== undefined) court.type = type ? String(type) : null;
    if (sportId !== undefined) court.sportId = sportId || null;
    if (isActive !== undefined) court.isActive = !!isActive;

    await tournament.save({ validateModifiedOnly: true });
    return res.status(200).json({ success: true, court });
  } catch (err) {
    console.error("[COURTS] updateCourt error:", err);
    return res.status(500).json({ success: false, message: "Failed to update court", error: err.message });
  }
};

// GET /api/tournaments/:tournamentId/courts/utilization
//   Per-court status counts across all 5 match collections, plus an
//   "unassigned" bucket for matches whose courtNumber doesn't match any
//   catalog name. Sub-step 6 — drives the UtilizationSection on CourtsPage.
//
//   Status buckets (Q1 = three): completed | inProgress | pending (anything
//   that isn't completed or in-progress, including SCHEDULED, null, missing).
//
//   v1: unscoped — counts matches across all sports (Q2). Catalog still
//   filtered to active by default; pass ?includeInactive=true to include
//   retired courts in the per-court list (their counts still come through
//   in the unassigned bucket if any matches reference retired names).
exports.getCourtUtilization = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const tournament = await Tournament.findById(tournamentId).select("courts").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    let catalog = tournament.courts || [];
    if (!includeInactive) catalog = catalog.filter((c) => c.isActive !== false);

    // Lazy-require the match models so we don't pull them in until this
    // endpoint is actually hit.
    const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
    const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
    const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
    const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
    const TeamKnockoutMatches = require("../src/modules/tournaments/models/TeamKnockoutMatches");

    // Lean projections — only the two fields we tally on. Single round-trip
    // fan-out via Promise.all.
    const PROJ = "courtNumber status";
    const FILTER = { tournamentId };
    const [m, sm, dkm, km, tkm] = await Promise.all([
      Match.find(FILTER, PROJ).lean(),
      SuperMatch.find(FILTER, PROJ).lean(),
      DirectKnockoutMatch.find(FILTER, PROJ).lean(),
      KnockoutMatch.find(FILTER, PROJ).lean(),
      TeamKnockoutMatches.find(FILTER, PROJ).lean(),
    ]);
    const allMatches = [...m, ...sm, ...dkm, ...km, ...tkm];

    // Three-bucket classifier. Match status casing varies across collections
    // (uppercase in some, lowercase in others, missing/null in legacy docs).
    const classify = (status) => {
      const s = String(status || "").toUpperCase().replace(/-/g, "_");
      if (s === "COMPLETED") return "completed";
      if (s === "IN_PROGRESS") return "inProgress";
      return "pending";
    };

    // Per-court tally keyed by court name (case-sensitive match against the
    // catalog). Initialize every catalog entry at zero so courts with no
    // matches still appear in the response.
    const tally = {};
    for (const c of catalog) {
      tally[c.name] = { all: 0, completed: 0, inProgress: 0, pending: 0 };
    }

    let unassignedAll = 0;
    let unassignedCompleted = 0;
    let unassignedInProgress = 0;
    let unassignedPending = 0;

    const catalogNames = new Set(catalog.map((c) => c.name));
    for (const match of allMatches) {
      const name = match.courtNumber;
      const bucket = classify(match.status);
      if (name && catalogNames.has(name)) {
        tally[name].all++;
        tally[name][bucket]++;
      } else {
        unassignedAll++;
        if (bucket === "completed") unassignedCompleted++;
        else if (bucket === "inProgress") unassignedInProgress++;
        else unassignedPending++;
      }
    }

    const courts = catalog.map((c) => ({
      _id: c._id,
      name: c.name,
      type: c.type || null,
      isActive: c.isActive !== false,
      totals: tally[c.name],
    }));

    return res.status(200).json({
      success: true,
      courts,
      unassigned: {
        all: unassignedAll,
        completed: unassignedCompleted,
        inProgress: unassignedInProgress,
        pending: unassignedPending,
      },
    });
  } catch (err) {
    console.error("[COURTS] getCourtUtilization error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to compute court utilization",
      error: err.message,
    });
  }
};

// DELETE /api/tournaments/:tournamentId/courts/:courtId
//   v1 = soft-delete only. Sets isActive: false. Past match assignments
//   keep displaying the name. Hard-delete deferred to v2 if ever needed.
exports.deleteCourt = async (req, res) => {
  try {
    const tournamentId = _validTournamentId(req, res);
    if (!tournamentId) return;

    const { courtId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(courtId)) {
      return res.status(400).json({ success: false, message: "Invalid courtId" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const court = tournament.courts.id(courtId);
    if (!court) {
      return res.status(404).json({ success: false, message: "Court not found on this tournament" });
    }

    if (court.isActive === false) {
      return res.status(200).json({
        success: true,
        message: "Court was already inactive",
        court,
      });
    }

    court.isActive = false;
    await tournament.save({ validateModifiedOnly: true });
    return res.status(200).json({
      success: true,
      message: `Court "${court.name}" has been deactivated. Past match assignments keep the name; new generations skip it.`,
      court,
    });
  } catch (err) {
    console.error("[COURTS] deleteCourt error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete court", error: err.message });
  }
};
