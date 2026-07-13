/**
 * Object-level authorization helpers (Phase 1).
 *
 * `authenticate` proves WHO the caller is; these enforce WHAT they may touch.
 * Applied at the route layer so controllers stay unchanged.
 *
 *   requireSelf(param)        — 403 unless the route :param equals the caller's id
 *   requireOwner({...})       — 403 unless the target document is owned by the caller
 *   forceSelfBody(field)      — overwrites req.body[field] with the caller's id
 *                               (stops a client from creating records "as" someone else)
 *
 * Assumes `authenticate` ran first and set req.user (JWT payload with .id).
 */
const mongoose = require("mongoose");

const callerId = (req) => req.user?.id || req.user?._id || null;

const requireSelf = (param = "userId") => (req, res, next) => {
  const me = callerId(req);
  if (!me) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  if (String(me) !== String(req.params[param])) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
};

const requireOwner = ({ model, ownerField, idParam = "id", idBody = null }) => async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const id = idBody ? req.body?.[idBody] : req.params?.[idParam];
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const Model = mongoose.model(model); // resolved lazily — all models are registered by request time
    const doc = await Model.findById(id).select(ownerField).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    if (String(doc[ownerField]) !== String(me)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  } catch (err) {
    next(err);
  }
};

const forceSelfBody = (field) => (req, res, next) => {
  const me = callerId(req);
  if (!me) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  req.body = { ...(req.body || {}), [field]: String(me) };
  next();
};

/**
 * requireTrainerOwns({ model, ownerField, idParam }) — like requireOwner, but
 * for resources whose ownerField references the *Trainer* collection rather
 * than User (e.g. Session.trainerId → ref "Trainer"). The caller authenticates
 * as a User, so we first resolve their Trainer profile (Trainer.userId === me),
 * then check the target document is owned by that Trainer.
 */
const requireTrainerOwns = ({ model, ownerField = "trainerId", idParam = "id" }) => async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const id = req.params?.[idParam];
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const trainer = await mongoose.model("Trainer").findOne({ userId: me }).select("_id").lean();
    if (!trainer) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const doc = await mongoose.model(model).findById(id).select(ownerField).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    if (String(doc[ownerField]) !== String(trainer._id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireTurfBookingOwner — for turf-booking status/payment routes. Resolves the
 * booking's turf, then allows the caller only if they are the turf `owner` (User)
 * or one of its `assignedManagers` (Manager). Works for both managerAuth callers
 * (Manager._id on req.user.id) and allowUserOrManager callers (doc on req.user._id).
 */
const requireTurfBookingOwner = ({ idParam = "bookingId" } = {}) => async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const bookingId = req.params?.[idParam];
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const booking = await mongoose.model("TurfBooking").findById(bookingId).select("turfId").lean();
    if (!booking) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    const turf = await mongoose.model("Turf").findById(booking.turfId).select("owner assignedManagers").lean();
    if (!turf) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    const isOwner = String(turf.owner) === String(me);
    const isAssigned =
      Array.isArray(turf.assignedManagers) &&
      turf.assignedManagers.some((m) => String(m) === String(me));
    if (!isOwner && !isAssigned) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireTurfOwner — like requireTurfBookingOwner but keyed directly by a turf
 * id param. Allows only the turf `owner` (User) or an `assignedManager` (Manager).
 */
const requireTurfOwner = ({ idParam = "turfId" } = {}) => async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const turfId = req.params?.[idParam];
    if (!mongoose.Types.ObjectId.isValid(turfId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const turf = await mongoose.model("Turf").findById(turfId).select("owner assignedManagers").lean();
    if (!turf) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    const isOwner = String(turf.owner) === String(me);
    const isAssigned =
      Array.isArray(turf.assignedManagers) &&
      turf.assignedManagers.some((m) => String(m) === String(me));
    if (!isOwner && !isAssigned) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireTournamentOwner — for tournament-management writes (edit/delete/whitelist).
 * A tournament is owned by the Managers in its `managerId` array. Allows:
 *   - a Manager whose id is in managerId,
 *   - a ClubAdmin/corporate User who owns one of those managers (Manager.clubId === caller),
 *   - a SuperAdmin (platform operator).
 * Pair with `allowUserOrManager` (which sets req.userRole + req.user as the doc).
 */
const requireTournamentOwner = ({ idParam = "id", idBody = null } = {}) => async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) return res.status(401).json({ success: false, message: "Authentication required" });
    if (req.userRole === "SuperAdmin") return next();
    // Resolve the tournament id from the URL param first, then the request body.
    // Many manage/score routes carry tournamentId in the body, not the path —
    // those were previously un-scoped (cross-tenant IDOR). idBody overrides the
    // body key; default falls back to `tournamentId`.
    let id = req.params?.[idParam];
    if (!id) id = idBody ? req.body?.[idBody] : req.body?.tournamentId;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid or missing tournament id" });
    }
    const t = await mongoose.model("Tournament").findById(id).select("managerId").lean();
    if (!t) return res.status(404).json({ success: false, message: "Not found" });
    const managerIds = (t.managerId || []).map(String);
    if (managerIds.includes(String(me))) return next();
    const ownsManager = await mongoose
      .model("Manager")
      .exists({ _id: { $in: t.managerId || [] }, clubId: me });
    if (ownsManager) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  } catch (err) {
    next(err);
  }
};

/**
 * scopeTournamentCreate — for POST /createTournament. Stops anonymous/spoofed
 * creation: a Manager is forced to create under their own id; a ClubAdmin/corporate
 * may only assign Managers they own; SuperAdmin is unrestricted; plain players are
 * rejected. Run AFTER the multipart parser so req.body.managerId is populated.
 */
const scopeTournamentCreate = async (req, res, next) => {
  try {
    const me = callerId(req);
    if (!me) return res.status(401).json({ success: false, message: "Authentication required" });
    if (req.userRole === "SuperAdmin") return next();
    if (req.userRole === "Manager") {
      req.body.managerId = [String(me)];
      return next();
    }
    // Event OS: agency users (AgencyAdmin/EventManager/Coordinator) create
    // tournaments under their own id, same as a Manager. The tournament is then
    // wrapped by an AgencyEvent in the Event OS.
    if (req.userRole === "User") {
      const u = await mongoose.model("User").findById(me).select("role").lean();
      const AGENCY_ROLES = ["AgencyAdmin", "agency_admin", "EventManager", "event_manager", "Coordinator", "coordinator"];
      if (u && AGENCY_ROLES.includes(u.role)) {
        req.body.managerId = [String(me)];
        return next();
      }
    }
    const raw = req.body?.managerId;
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x) =>
      mongoose.Types.ObjectId.isValid(x)
    );
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "managerId is required" });
    }
    const owned = await mongoose.model("Manager").countDocuments({ _id: { $in: ids }, clubId: me });
    if (owned !== ids.length) {
      return res.status(403).json({ success: false, message: "Cannot assign managers you do not own" });
    }
    return next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requireSelf,
  requireOwner,
  forceSelfBody,
  requireTrainerOwns,
  requireTurfBookingOwner,
  requireTurfOwner,
  requireTournamentOwner,
  scopeTournamentCreate,
};
