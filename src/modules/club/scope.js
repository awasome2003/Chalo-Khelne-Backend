/**
 * Club (facility-business) tenant scoping. Mirrors events/scope.js.
 * clubId = the club_admin's own User._id (or user.clubId if ever set).
 */
const User = require("../identity/models/User");

async function resolveClubId(req) {
  const id = req.user?.id || req.user?._id || req.accountId;
  if (!id) return null;
  const user = await User.findById(id).select("clubId").lean();
  if (!user) return null;
  return user.clubId || id; // facility clubs have no clubId → they ARE the tenant
}

module.exports = { resolveClubId };
