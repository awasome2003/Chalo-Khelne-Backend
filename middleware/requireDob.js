// Families Policy: block age-gated features until the account's age is known.
//
// Google Sign-In creates an account before a DOB can be collected (Google does
// not return a birthday, and the row is created by the OAuth callback itself).
// Rather than making that impossible at the schema level — which only produced
// a 500 and no account — such users are created with `dobRequired: true` and
// stopped HERE, at the point of access. This is the enforcement point that
// actually satisfies the policy: the user cannot reach an age-gated feature
// without a known age.
//
// Mount on: chat, social/follow, posts/stories, tournament registration.
//
// Gated by ENFORCE_DOB_GATE because ~70% of existing age-gated accounts predate
// the DOB requirement. Enabling it before the mobile DOB screen ships would
// hand those users a 403 with no way to resolve it. Rollout order:
//   1. deploy this (flag off)  → nothing changes
//   2. ship the app build with the blocking DOB screen
//   3. set ENFORCE_DOB_GATE=true and restart → gate goes live
const User = require("../src/modules/identity/models/User");
const { isDobGateEnabled } = require("../utils/contactGuard");

async function requireDob(req, res, next) {
  if (!isDobGateEnabled()) return next();

  const userId = req.user?.id || req.user?._id || req.user?.userId;
  if (!userId) return next(); // unauthenticated — the auth middleware owns this

  try {
    const user = await User.findById(userId).select("dateOfBirth dobRequired role");
    if (!user) return next();

    // Roles outside the age-gated set (ClubAdmin, Manager, …) are onboarded
    // without a DOB by design and must not be blocked.
    if (!User.AGE_GATED_ROLES.includes(user.role)) return next();

    if (user.dateOfBirth && !user.dobRequired) return next();

    return res.status(403).json({
      success: false,
      code: "DOB_REQUIRED",
      message: "Please add your date of birth to continue.",
    });
  } catch (err) {
    // Fail CLOSED: an age check that errors must not silently grant access.
    console.error("[requireDob] lookup failed:", err.message);
    return res.status(403).json({
      success: false,
      code: "DOB_REQUIRED",
      message: "Please add your date of birth to continue.",
    });
  }
}

module.exports = { requireDob };
