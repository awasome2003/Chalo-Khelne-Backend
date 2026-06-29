// Families Policy enforcement: a conversation that involves a MINOR is only
// allowed between "known contacts". Per the product decision, a known contact
// is a MUTUAL FOLLOW (both users follow each other). This is enforced
// server-side so the rule holds regardless of the client.

const User = require("../src/modules/identity/models/User");

// Robust minor check. The pre-save hook computes User.isMinor from DOB, but
// legacy docs created before that hook may not have it set — so we recompute
// from dateOfBirth when available and OR it with the stored flag.
function computeIsMinor(user) {
  if (!user) return false;
  if (user.dateOfBirth) {
    const d = new Date(user.dateOfBirth);
    if (!isNaN(d.getTime())) {
      const t = new Date();
      let a = t.getFullYear() - d.getFullYear();
      const m = t.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
      return a < 18;
    }
  }
  return user.isMinor === true;
}

function mutualFollow(a, b) {
  const aFollowsB = (a.following || []).some((id) => String(id) === String(b._id));
  const bFollowsA = (b.following || []).some((id) => String(id) === String(a._id));
  return aFollowsB && bFollowsA;
}

const SELECT = "isMinor dateOfBirth following followers";

// Are a and b mutual follows? (ids)
async function isKnownContact(aId, bId) {
  const [a, b] = await Promise.all([
    User.findById(aId).select(SELECT),
    User.findById(bId).select(SELECT),
  ]);
  if (!a || !b) return false;
  return mutualFollow(a, b);
}

// Is a conversation between aId and bId permitted under Families Policy?
// Returns { allowed: boolean, reason?: string, involvesMinor: boolean }.
async function conversationAllowed(aId, bId) {
  const [a, b] = await Promise.all([
    User.findById(aId).select(SELECT),
    User.findById(bId).select(SELECT),
  ]);
  if (!a || !b) {
    return { allowed: false, reason: "User not found", involvesMinor: false };
  }
  const involvesMinor = computeIsMinor(a) || computeIsMinor(b);
  if (!involvesMinor) return { allowed: true, involvesMinor: false };
  if (mutualFollow(a, b)) return { allowed: true, involvesMinor: true };
  return {
    allowed: false,
    involvesMinor: true,
    reason:
      "For safety, younger players can only chat with people they're connected with. Follow each other first to start chatting.",
  };
}

module.exports = { isKnownContact, conversationAllowed, computeIsMinor };
