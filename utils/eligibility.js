// Age + gender eligibility for tournament categories.
//
// minAge / maxAge on a category are inclusive caps on the player's age at the
// tournament start date. We derive the birth-date cutoffs on the fly from
// `tournament.startDate` (stored as a String on the schema) rather than
// caching them on the category, so editing the tournament date never leaves a
// stale cutoff behind.
//
// Returns { eligible: boolean, reason?: string }. Reason is intended for the
// mobile UI's grey-out caption — keep it short and player-facing.

const GENDER_LABELS = { male: "Male", female: "Female" };

function parseTournamentDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  const s = String(raw).trim();

  // ISO / native-parseable first (handles "2019-02-20", "2019-02-20T...").
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return native;

  // Fallback: DD-MM-YYYY or DD/MM/YYYY (the format the spec uses for DOB).
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function ageOn(referenceDate, dob) {
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const md = referenceDate.getMonth() - dob.getMonth();
  if (md < 0 || (md === 0 && referenceDate.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * @param {Object} user           User document (needs dateOfBirth + sex).
 * @param {Object} category       Embedded category doc (name, minAge, maxAge, gender).
 * @param {string|Date} tournamentStartDate  Tournament.startDate.
 * @returns {{eligible: boolean, reason?: string}}
 */
function eligibilityFor(user, category, tournamentStartDate) {
  const categoryGender = (category?.gender || "any").toLowerCase();
  const userGender = (user?.sex || "").toLowerCase();

  if (categoryGender !== "any") {
    if (!userGender) {
      return { eligible: false, reason: "Set gender in your profile to register" };
    }
    if (userGender !== categoryGender) {
      return {
        eligible: false,
        reason: `${GENDER_LABELS[categoryGender]} players only`,
      };
    }
  }

  const hasAgeBound =
    category?.minAge !== null && category?.minAge !== undefined ||
    category?.maxAge !== null && category?.maxAge !== undefined;

  if (!hasAgeBound) return { eligible: true };

  if (!user?.dateOfBirth) {
    return { eligible: false, reason: "Add your date of birth to register" };
  }
  const dob = user.dateOfBirth instanceof Date
    ? user.dateOfBirth
    : new Date(user.dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return { eligible: false, reason: "Date of birth on profile is invalid" };
  }

  const tStart = parseTournamentDate(tournamentStartDate);
  if (!tStart) {
    // Misconfigured tournament — surface to the caller so it can 500 rather
    // than silently letting an ineligible player through.
    const err = new Error("Tournament start date is missing or unparseable");
    err.code = "TOURNAMENT_DATE_INVALID";
    throw err;
  }

  const playerAge = ageOn(tStart, dob);

  if (category.minAge != null && playerAge < category.minAge) {
    return { eligible: false, reason: `Minimum age is ${category.minAge}` };
  }
  if (category.maxAge != null && playerAge > category.maxAge) {
    return { eligible: false, reason: `Maximum age is ${category.maxAge}` };
  }

  return { eligible: true };
}

/**
 * Find a category by sportId + categoryName on a tournament document.
 * Returns null if not found. Used by the booking controller to look up the
 * category for each entry in sportSelections.
 */
function findCategory(tournament, sportId, categoryName) {
  if (!tournament || !Array.isArray(tournament.sports)) return null;
  const track = tournament.sports.find(
    (t) => String(t.sportId) === String(sportId)
  );
  if (!track || !Array.isArray(track.categories)) return null;
  return track.categories.find((c) => c.name === categoryName) || null;
}

module.exports = { eligibilityFor, findCategory, parseTournamentDate, ageOn };
