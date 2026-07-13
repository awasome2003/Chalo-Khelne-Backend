/**
 * Shared agency-scope helpers for Event-OS sub-resource controllers
 * (officials, staff, equipment, sponsors, …). Keeps every sub-resource
 * agency-scoped + verifies the parent event belongs to the caller's agency.
 */
const User = require("../identity/models/User");

async function resolveAgencyId(req) {
  const uid = req.user?.id || req.user?._id || req.user?.userId;
  if (!uid) return null;
  const user = await User.findById(uid).select("agencyId").lean();
  return user ? (user.agencyId || user._id) : null;
}

async function getScopedEvent(req, AgencyEvent) {
  const agencyId = await resolveAgencyId(req);
  if (!agencyId) return { agencyId: null, event: null };
  const event = await AgencyEvent.findOne({ _id: req.params.id, agencyId }).lean();
  return { agencyId, event };
}

module.exports = { resolveAgencyId, getScopedEvent };
