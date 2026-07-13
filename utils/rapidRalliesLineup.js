/**
 * Rapid Rallies S1 — lineup constraint engine (PURE, no DB/mongoose).
 *
 * Owns every rule of the "Dynamic Selection System" so both lineup modes and
 * both the server + UI can share one source of truth:
 *
 *   Roster        : slots P1..P5, exactly one designated female at P3.
 *   Rubber 1      : Singles  home P1 vs away P2            (fixed, cross-seed)
 *   Rubber 2      : Doubles  home P2+partner / away P1+partner   (partner ∈ P3–P5)
 *   Rubber 3      : Singles  home P3 vs away P3            (female, fixed)
 *   Rubber 4      : Doubles  home P1+partner / away P2+partner   (partner ∈ P3–P5)
 *   Rubber 5      : Singles  a player who has NOT yet played a singles rubber
 *                            (home ∈ {P2,P4,P5}, away ∈ {P1,P4,P5})
 *
 * Rules enforced:
 *   • female    — roster slot P3 is female.
 *   • pool      — doubles partners come only from {P3,P4,P5}.
 *   • A1≠A2     — falls out for free: anchors P1/P2 are never in the partner pool.
 *   • rubber-5  — the rubber-5 player must not have played a singles rubber.
 *   • all-play  — all 5 players play ≥1 rubber. Since P1,P2,P3 always play fixed
 *                 rubbers, this reduces to: P4 AND P5 each appear as a doubles
 *                 partner (rubber 2 or 4) or as the rubber-5 singles player.
 *
 * Home/away are symmetric with the doubles anchors swapped, so every function
 * takes an explicit `side` ("home" | "away").
 *
 * Selection shape (per team, per tie):
 *   { partner2, partner4, singles5 }  — each a slot string like "P4".
 */

const SLOTS = ["P1", "P2", "P3", "P4", "P5"];
const FEMALE_SLOT = "P3";
const PARTNER_POOL = ["P3", "P4", "P5"];
const DYNAMIC_FIELDS = ["partner2", "partner4", "singles5"];

// Slots that play a SINGLES rubber before rubber 5 (so are ineligible for it).
const SINGLES_BEFORE_R5 = { home: ["P1", "P3"], away: ["P2", "P3"] };

/** Slots eligible for the rubber-5 singles on a given side (= not-played-singles). */
function rubber5Eligible(side) {
  const played = SINGLES_BEFORE_R5[side] || [];
  return SLOTS.filter((s) => !played.includes(s));
}

/** Allowed values for a dynamic field on a given side. */
function domainOf(field, side) {
  if (field === "partner2" || field === "partner4") return PARTNER_POOL.slice();
  if (field === "singles5") return rubber5Eligible(side);
  return [];
}

// ── Roster normalization ────────────────────────────────────────────
function normGender(g) {
  if (typeof g !== "string") return null;
  const v = g.trim().toLowerCase();
  if (v === "female" || v === "f" || v === "w" || v === "woman") return "female";
  if (v === "male" || v === "m" || v === "man") return "male";
  return null;
}

/**
 * Accepts either { P1:{name,gender}, ... } or [{slot,name,gender}, ...] and
 * returns a plain map keyed by slot. Unknown/extra slots are ignored.
 */
function normalizeRoster(roster) {
  const map = {};
  if (Array.isArray(roster)) {
    roster.forEach((r) => {
      if (r && r.slot) map[r.slot] = { name: r.name, gender: normGender(r.gender) };
    });
  } else if (roster && typeof roster === "object") {
    Object.keys(roster).forEach((slot) => {
      const r = roster[slot] || {};
      map[slot] = { name: r.name, gender: normGender(r.gender) };
    });
  }
  return map;
}

// ── Roster validation ───────────────────────────────────────────────
/** Validate a single team's roster (5 slots, names present, P3 female). */
function validateRoster(roster) {
  const errors = [];
  const map = normalizeRoster(roster);

  SLOTS.forEach((slot) => {
    const entry = map[slot];
    if (!entry || !entry.name || String(entry.name).trim() === "") {
      errors.push(`Roster slot ${slot} is missing a player.`);
    }
  });

  const p3 = map[FEMALE_SLOT];
  if (p3 && p3.name) {
    if (p3.gender !== "female") {
      errors.push(`Roster slot ${FEMALE_SLOT} must be a female player (plays the female singles rubber).`);
    }
  }

  const femaleCount = SLOTS.filter((s) => map[s] && map[s].gender === "female").length;
  if (femaleCount < 1) errors.push("Roster must contain at least one female player.");

  return { valid: errors.length === 0, errors };
}

// ── Selection validation ────────────────────────────────────────────
/**
 * Validate a COMPLETE selection for one side (used by upfront mode and as the
 * final gate in dynamic mode once all three fields are locked).
 *
 * @param {"home"|"away"} side
 * @param {object} selection { partner2, partner4, singles5 }
 * @returns {{valid:boolean, errors:string[]}}
 */
function validateSelection(side, selection = {}) {
  const errors = [];
  const { partner2, partner4, singles5 } = selection;

  DYNAMIC_FIELDS.forEach((f) => {
    if (!selection[f]) errors.push(`${side}: ${labelFor(f)} not selected.`);
  });
  if (errors.length) return { valid: false, errors };

  // Pool / eligibility
  if (!PARTNER_POOL.includes(partner2)) errors.push(`${side}: rubber-2 partner must be one of ${PARTNER_POOL.join("/")}.`);
  if (!PARTNER_POOL.includes(partner4)) errors.push(`${side}: rubber-4 partner must be one of ${PARTNER_POOL.join("/")}.`);
  const elig = rubber5Eligible(side);
  if (!elig.includes(singles5)) {
    errors.push(`${side}: rubber-5 player must be someone who has not played a singles rubber (${elig.join("/")}).`);
  }

  // Participation — P4 and P5 must each appear among the dynamic picks.
  const dyn = [partner2, partner4, singles5];
  if (!dyn.includes("P4")) errors.push(`${side}: P4 never plays — all 5 players must play at least one rubber.`);
  if (!dyn.includes("P5")) errors.push(`${side}: P5 never plays — all 5 players must play at least one rubber.`);

  return { valid: errors.length === 0, errors };
}

function labelFor(field) {
  return { partner2: "rubber-2 doubles partner", partner4: "rubber-4 doubles partner", singles5: "rubber-5 singles player" }[field] || field;
}

// ── Dynamic-mode feasibility ────────────────────────────────────────
/**
 * Can a partial selection still be completed into a fully-valid lineup?
 * Brute-forces the (≤27) completions of the unset dynamic fields.
 */
function isCompletable(side, partial = {}) {
  const open = DYNAMIC_FIELDS.filter((f) => !partial[f]);
  const combos = cartesian(open.map((f) => domainOf(f, side)));
  return combos.some((combo) => {
    const candidate = { ...partial };
    open.forEach((f, i) => { candidate[f] = combo[i]; });
    return validateSelection(side, candidate).valid;
  });
}

/**
 * The valid choices for `field` given what's already chosen — i.e. picks that
 * keep a fully-valid completion possible. This is what the UI shows in dynamic
 * mode so a captain can never paint themselves into an invalid corner.
 */
function validOptionsFor(side, field, partial = {}) {
  return domainOf(field, side).filter((val) =>
    isCompletable(side, { ...partial, [field]: val })
  );
}

function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((prefix) => arr.map((v) => [...prefix, v])),
    [[]]
  );
}

// ── Whole-tie convenience ───────────────────────────────────────────
/**
 * Validate a full tie: both rosters + both sides' complete selections.
 * Returns a flat, side-prefixed error list.
 */
function validateTie({ homeRoster, awayRoster, homeSelection, awaySelection } = {}) {
  const errors = [];
  const hr = validateRoster(homeRoster);
  const ar = validateRoster(awayRoster);
  hr.errors.forEach((e) => errors.push(`home roster: ${e}`));
  ar.errors.forEach((e) => errors.push(`away roster: ${e}`));
  validateSelection("home", homeSelection).errors.forEach((e) => errors.push(e));
  validateSelection("away", awaySelection).errors.forEach((e) => errors.push(e));
  return { valid: errors.length === 0, errors };
}

// ── Resolution (selection → per-rubber player slots) ────────────────
/**
 * Resolve the concrete home/away slot pairs for every rubber given a side's
 * roster is indexed by slot. Used by generation/scoring (P2) to fill the
 * TeamKnockoutMatches `sets[]`. Names are resolved by the caller from rosters.
 *
 * @returns array of { setNumber, type, homeSlots:[], awaySlots:[] }
 */
function resolveRubbers(homeSelection = {}, awaySelection = {}) {
  return [
    { setNumber: 1, type: "singles", homeSlots: ["P1"], awaySlots: ["P2"] },
    { setNumber: 2, type: "doubles", homeSlots: ["P2", homeSelection.partner2], awaySlots: ["P1", awaySelection.partner2] },
    { setNumber: 3, type: "singles", homeSlots: ["P3"], awaySlots: ["P3"] },
    { setNumber: 4, type: "doubles", homeSlots: ["P1", homeSelection.partner4], awaySlots: ["P2", awaySelection.partner4] },
    { setNumber: 5, type: "singles", homeSlots: [homeSelection.singles5 || "P2"], awaySlots: [awaySelection.singles5 || "P1"] },
  ];
}

module.exports = {
  SLOTS,
  FEMALE_SLOT,
  PARTNER_POOL,
  DYNAMIC_FIELDS,
  rubber5Eligible,
  domainOf,
  normalizeRoster,
  validateRoster,
  validateSelection,
  isCompletable,
  validOptionsFor,
  validateTie,
  resolveRubbers,
};
