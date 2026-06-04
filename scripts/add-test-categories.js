/**
 * Seeds a spread of age-bound categories on a tournament's sport tracks so
 * we can exercise the mobile-side age-eligibility check end to end.
 *
 * Each test category sets explicit minAge / maxAge / gender — without those,
 * `utils/eligibility.js` short-circuits to `{ eligible: true }` for any
 * category and the server gate becomes a no-op (which is exactly what bit
 * us the first time round).
 *
 * Applies to ALL sports[] entries on the doc. UPSERTS bounds — re-running
 * back-fills missing minAge/maxAge/gender on pre-existing test categories
 * that were created before this fix.
 *
 * Also REVERTS the prior wrong-tournament run.
 *
 * Test matrix vs. a player born 22 Sept 2003 (~22 years old today):
 *
 *   Under 12 → max 11  → REJECT ("Maximum age is 11")
 *   Under 15 → max 14  → REJECT ("Maximum age is 14")
 *   Under 18 → max 17  → REJECT ("Maximum age is 17")
 *   Under 25 → max 24  → ALLOW  (player is 22)
 *   Above 40 → min 40  → REJECT ("Minimum age is 40")
 *   Doubles  → no age  → ALLOW
 *   Open Category (already present) → ALLOW
 *
 * Usage:
 *   cd Old_Version/server
 *   node scripts/add-test-categories.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Tournament = require("../Modal/Tournament");

const TARGET_ID = "69f340cfb16abf19e2875e52"; // Summer Championship (Badminton + Table Tennis)
const REVERT_ID = "69d8864388862c5c342ed1d3"; // Wrong target from the first run

// `Under N` parses to maxAge = N-1 (strictly "under N years old").
// `Above N` parses to minAge = N (40+ inclusive).
const TEST_CATEGORIES = [
  { name: "Under 12", fee: 0, minAge: null, maxAge: 11,   gender: "any" },
  { name: "Under 15", fee: 0, minAge: null, maxAge: 14,   gender: "any" },
  { name: "Under 18", fee: 0, minAge: null, maxAge: 17,   gender: "any" },
  { name: "Under 25", fee: 0, minAge: null, maxAge: 24,   gender: "any" },
  { name: "Above 40", fee: 0, minAge: 40,   maxAge: null, gender: "any" },
  { name: "Doubles",  fee: 0, minAge: null, maxAge: null, gender: "any" },
];

const TEST_NAMES_LC = new Set(TEST_CATEGORIES.map((c) => c.name.toLowerCase()));

async function upsertCategoriesOnAllSports(tournamentId) {
  const t = await Tournament.findById(tournamentId);
  if (!t) {
    console.error(`[upsert] Tournament ${tournamentId} not found`);
    return;
  }
  console.log(`\n[upsert] "${t.title}" — ${t.sports?.length || 0} sport track(s)`);

  let added = 0;
  let patched = 0;

  for (const sport of t.sports || []) {
    sport.categories = sport.categories || [];
    const byName = new Map(
      sport.categories.map((c) => [String(c.name || "").toLowerCase(), c])
    );

    const actions = [];
    for (const spec of TEST_CATEGORIES) {
      const existing = byName.get(spec.name.toLowerCase());
      if (!existing) {
        sport.categories.push({ ...spec });
        actions.push(`+ ${spec.name}`);
        added++;
      } else {
        // Back-fill bounds — set if the current value differs from the spec.
        const wantMin    = spec.minAge;
        const wantMax    = spec.maxAge;
        const wantGender = spec.gender;
        const needsPatch =
          existing.minAge !== wantMin ||
          existing.maxAge !== wantMax ||
          (existing.gender || "any") !== wantGender;
        if (needsPatch) {
          existing.minAge = wantMin;
          existing.maxAge = wantMax;
          existing.gender = wantGender;
          actions.push(`~ ${spec.name}`);
          patched++;
        }
      }
    }

    if (actions.length === 0) {
      console.log(`   · ${sport.sportName.padEnd(14)} — no change`);
    } else {
      console.log(`   ${sport.sportName.padEnd(14)} — ${actions.join(", ")}`);
    }
  }

  if (added > 0 || patched > 0) {
    // Mongoose doesn't always detect mutations on deeply-nested subdocs.
    t.markModified("sports");
    await t.save();
    console.log(`[upsert] saved (added=${added}, patched=${patched})`);
  } else {
    console.log(`[upsert] no save needed`);
  }

  console.log(`\n[final] categories with bounds:`);
  for (const sport of t.sports || []) {
    console.log(`         ${sport.sportName}:`);
    (sport.categories || []).forEach((c) => {
      const bounds = [
        c.minAge != null ? `min=${c.minAge}` : null,
        c.maxAge != null ? `max=${c.maxAge}` : null,
        c.gender && c.gender !== "any" ? `gender=${c.gender}` : null,
      ].filter(Boolean).join(", ") || "no bounds";
      console.log(`           · ${c.name.padEnd(18)} [${bounds}]`);
    });
  }
}

async function revertCategoriesFromAllSports(tournamentId) {
  const t = await Tournament.findById(tournamentId);
  if (!t) {
    console.log(`[revert] ${tournamentId} not found, nothing to revert`);
    return;
  }
  console.log(`\n[revert] "${t.title}" — removing test categories`);

  let totalRemoved = 0;
  for (const sport of t.sports || []) {
    const before = sport.categories?.length || 0;
    sport.categories = (sport.categories || []).filter(
      (c) => !TEST_NAMES_LC.has(String(c.name || "").toLowerCase())
    );
    const removed = before - sport.categories.length;
    if (removed > 0) {
      console.log(`   - ${sport.sportName.padEnd(14)} — removed ${removed}`);
      totalRemoved += removed;
    }
  }

  if (totalRemoved > 0) {
    t.markModified("sports");
    await t.save();
    console.log(`[revert] saved (${totalRemoved} removed)`);
  } else {
    console.log(`[revert] nothing to remove`);
  }
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing from .env — run from Old_Version/server/");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[mongo] connected");

  await revertCategoriesFromAllSports(REVERT_ID);
  await upsertCategoriesOnAllSports(TARGET_ID);

  await mongoose.disconnect();
  console.log("\n[mongo] disconnected");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
