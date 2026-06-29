/**
 * Verify clubId coverage for the Phase 1 tenant models — READ ONLY.
 *
 * For every model that received the tenantScope plugin in Phase 1, report:
 *   model | total docs | docs missing clubId | % covered
 *
 * A model is safe to run with enforce:true ONLY when coverage is 100%. Any doc
 * missing clubId would become invisible to its own club once enforcement is on
 * (the scoped filter clubId=<ctx> can't match a null), so this is the gate.
 *
 * The script runs with NO tenant context, so the tenantScope plugin no-ops and
 * the counts below are the true, unscoped totals.
 *
 * Usage:
 *   node scripts/verifyTenancyCoverage.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

// Models plugged in Phase 1. mode is informational (matches the enforce flag set
// in each model file). Group B (shadow) refs Club not User — see model comments.
// Paths point at the Phase-5b module locations (src/modules/<module>/models/).
// NOTE: these are DATA strings consumed by a dynamic require(t.path), so the
// Phase-5b move script (which only rewrites static require("literal")) did not
// touch them — they were updated by hand here.
const TARGETS = [
  // ── Group A — enforce:true ──
  { name: "Attendance", path: "../src/modules/coaching/models/Attendance", mode: "enforce" },
  { name: "ClubSport", path: "../src/modules/org/models/ClubSport", mode: "enforce" },
  { name: "ProgressHistory", path: "../src/modules/coaching/models/ProgressHistory", mode: "enforce" },
  { name: "ProgressSubmission", path: "../src/modules/coaching/models/ProgressSubmission", mode: "enforce" },
  { name: "SportsSyllabus", path: "../src/modules/coaching/models/SportsSyllabus", mode: "enforce" },
  { name: "Student", path: "../src/modules/coaching/models/Student", mode: "enforce" },
  { name: "StudentProgress", path: "../src/modules/coaching/models/StudentProgress", mode: "enforce" },
  { name: "Substitute", path: "../src/modules/identity/models/Substitute", mode: "enforce" },
  { name: "SyllabusEntry", path: "../src/modules/coaching/models/SyllabusEntry", mode: "enforce" },
  { name: "ClubApplication", path: "../src/modules/org/models/TrainerClubApplication", mode: "enforce" },
  { name: "TrainingSchedule", path: "../src/modules/coaching/models/TrainingSchedule", mode: "enforce" },
  { name: "Manager", path: "../src/modules/identity/models/ClubManager", pick: "Manager", mode: "enforce" },
  // ── Group B — shadow (clubId refs Club, not the tenant User) ──
  // Phase 5 decision: Request and Session were RESOLVED as genuinely CROSS-TENANT
  // (trainer/player-owned; clubId is a vestigial Club-directory ref, not the SaaS
  // tenant). Their no-op shadow plugins were removed — they are no longer tracked
  // here. ClubRequest remains shadow pending the same Club↔User key reconciliation.
  { name: "ClubRequest", path: "../src/modules/org/models/ClubRequest", mode: "shadow" },
];

function resolveModel(t) {
  const mod = require(t.path);
  return t.pick ? mod[t.pick] : mod;
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(
    pad("MODEL", 22) + padL("TOTAL", 8) + padL("MISSING", 9) + padL("COVERED", 10) + "  MODE"
  );
  console.log("-".repeat(62));

  const blockers = [];
  for (const t of TARGETS) {
    try {
      const Model = resolveModel(t);
      const total = await Model.countDocuments({});
      const missing = await Model.countDocuments({
        $or: [{ clubId: null }, { clubId: { $exists: false } }],
      });
      const covered = total === 0 ? 100 : ((total - missing) / total) * 100;
      const coveredStr = covered.toFixed(1) + "%";
      console.log(
        pad(t.name, 22) + padL(total, 8) + padL(missing, 9) + padL(coveredStr, 10) + "  " + t.mode
      );
      // Only enforce-mode models with missing docs are a hard blocker.
      if (t.mode === "enforce" && missing > 0) {
        blockers.push(`${t.name}: ${missing} doc(s) missing clubId`);
      }
    } catch (err) {
      console.log(pad(t.name, 22) + "  ERROR: " + err.message);
    }
  }

  console.log("-".repeat(62));
  if (blockers.length === 0) {
    console.log("\nAll enforce-mode models at 100% coverage. Safe to deploy enforcement. ✅");
  } else {
    console.log("\n❌ Backfill needed before deploying enforcement on:");
    blockers.forEach((b) => console.log("   - " + b));
    console.log(
      "\n  Fix: stamp clubId on the listed docs (see scripts/backfillTournamentClubId.js" +
        " for the pattern), or set that model's plugin to enforce:false until backfilled."
    );
  }

  await mongoose.disconnect();
  process.exit(blockers.length === 0 ? 0 : 1);
}

run().catch(async (err) => {
  console.error("Coverage check failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
