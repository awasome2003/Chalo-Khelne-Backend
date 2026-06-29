// server/scripts/verifyBookingMigration.js
//
// Verifies the STEP 9d booking migration outcome and (optionally) re-runs
// the migration for any bookings that slipped through. Idempotent — safe
// to re-run.
//
// Usage:
//   node server/scripts/verifyBookingMigration.js                 (audit only)
//   node server/scripts/verifyBookingMigration.js --migrate --dry-run  (simulate)
//   node server/scripts/verifyBookingMigration.js --migrate            (real run)
//
// IMPORTANT (production):
//   1. Take the API offline (no concurrent booking writes).
//   2. Snapshot bookings: mongodump --collection bookings --out <backup>
//   3. Run audit-only first; review the JSON log.
//   4. If `legacyOnly > 0`, run --migrate --dry-run; review.
//   5. If clean: run --migrate (real).
//   6. Re-run audit; confirm legacyOnly === 0.
//   7. Bring API back online.

// Resolve .env relative to this script's location so the script works
// regardless of cwd. Tries server/.env first, then project-root .env,
// then the cwd default as a last resort.
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const candidateEnvPaths = [
  path.join(__dirname, "..", ".env"),       // server/.env
  path.join(__dirname, "..", "..", ".env"), // project-root/.env
];
let loadedEnv = null;
for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    loadedEnv = p;
    break;
  }
}
if (!loadedEnv) dotenv.config(); // fall back to cwd default
const mongoose = require("mongoose");

const MIGRATE = process.argv.includes("--migrate");
const DRY_RUN = process.argv.includes("--dry-run");

const MODE = MIGRATE
  ? (DRY_RUN ? "migrate-dry-run" : "migrate")
  : "audit";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("[VERIFY-BOOKING] MONGO_URI not set in env. Aborting.");
    process.exit(1);
  }

  console.log(`\n[VERIFY-BOOKING] Mode: ${MODE}`);
  if (loadedEnv) console.log(`[VERIFY-BOOKING] Loaded env from: ${loadedEnv}`);
  console.log(`[VERIFY-BOOKING] Connecting to MongoDB...`);
  await mongoose.connect(uri);

  const Booking = require("../src/modules/tournaments/models/BookingModel");
  const Tournament = require("../src/modules/tournaments/models/Tournament");

  const log = {
    startedAt: new Date().toISOString(),
    mode: MODE,
    audit: {
      total: 0,
      migrated: 0,
      legacyOnly: 0,
      empty: 0,
      missingTotalFee: 0,
      totalFeeMismatch: 0,
    },
    migration: null,
    anomalies: {
      totalFeeMismatchSamples: [],
      legacyOnlySamples: [],
      missingTotalFeeSamples: [],
    },
    errors: [],
  };

  // ------------------------------------------------------------
  // PASS 1 — AUDIT (read-only)
  // ------------------------------------------------------------
  console.log(`[VERIFY-BOOKING] Auditing bookings...`);
  const allBookings = await Booking.find({}).lean();
  log.audit.total = allBookings.length;

  for (const b of allBookings) {
    const ss = Array.isArray(b.sportSelections) ? b.sportSelections : [];
    const sc = Array.isArray(b.selectedCategories) ? b.selectedCategories : [];
    const hasSS = ss.length > 0;
    const hasSC = sc.length > 0;

    if (hasSS) {
      log.audit.migrated++;
      // totalFee anomaly checks (only on migrated docs).
      const ssSum = ss.reduce((s, x) => s + Number(x.fee || 0), 0);
      if (b.totalFee == null || b.totalFee === undefined) {
        log.audit.missingTotalFee++;
        if (log.anomalies.missingTotalFeeSamples.length < 10) {
          log.anomalies.missingTotalFeeSamples.push({
            bookingId: String(b._id),
            tournamentId: String(b.tournamentId),
            ssSum,
            paymentAmount: b.paymentAmount,
          });
        }
      } else if (Number(b.totalFee) !== ssSum) {
        log.audit.totalFeeMismatch++;
        if (log.anomalies.totalFeeMismatchSamples.length < 10) {
          log.anomalies.totalFeeMismatchSamples.push({
            bookingId: String(b._id),
            tournamentId: String(b.tournamentId),
            expected: ssSum,
            actual: b.totalFee,
            paymentAmount: b.paymentAmount,
          });
        }
      }
    } else if (hasSC) {
      log.audit.legacyOnly++;
      if (log.anomalies.legacyOnlySamples.length < 10) {
        log.anomalies.legacyOnlySamples.push({
          bookingId: String(b._id),
          tournamentId: String(b.tournamentId),
          userId: String(b.userId),
          selectedCategories: sc.map((c) => ({ name: c.name, price: c.price })),
        });
      }
    } else {
      log.audit.empty++;
    }
  }

  console.log(`\n[VERIFY-BOOKING] Audit results:`);
  console.log(`  total                          : ${log.audit.total}`);
  console.log(`  migrated (sportSelections > 0) : ${log.audit.migrated}`);
  console.log(`  legacy-only (sc > 0, ss empty) : ${log.audit.legacyOnly}`);
  console.log(`  empty (both arrays empty)      : ${log.audit.empty}`);
  console.log(`  migrated · missing totalFee    : ${log.audit.missingTotalFee}`);
  console.log(`  migrated · totalFee mismatch   : ${log.audit.totalFeeMismatch}`);

  // ------------------------------------------------------------
  // PASS 2 — MIGRATE (optional, only when --migrate)
  // ------------------------------------------------------------
  if (MIGRATE) {
    log.migration = { touched: 0, skipped: 0, errors: 0 };
    console.log(`\n[VERIFY-BOOKING] ${DRY_RUN ? "[DRY-RUN] " : ""}Migrating legacy-only bookings...`);

    if (log.audit.legacyOnly === 0) {
      console.log(`[VERIFY-BOOKING] Nothing to migrate — legacy-only count is 0.`);
    } else {
      // Pre-cache tournaments for all legacy-only bookings.
      const tournamentIds = new Set();
      for (const b of allBookings) {
        const ss = Array.isArray(b.sportSelections) ? b.sportSelections : [];
        const sc = Array.isArray(b.selectedCategories) ? b.selectedCategories : [];
        if (ss.length === 0 && sc.length > 0 && b.tournamentId) {
          tournamentIds.add(String(b.tournamentId));
        }
      }
      const tournaments = await Tournament.find({
        _id: { $in: [...tournamentIds] },
      }).lean();
      const tournamentMap = new Map(
        tournaments.map((t) => [
          String(t._id),
          {
            sportId: t.sports?.[0]?.sportId || null,
            sportName: t.sports?.[0]?.sportName || t.sportsType || null,
          },
        ])
      );

      for (const b of allBookings) {
        const ss = Array.isArray(b.sportSelections) ? b.sportSelections : [];
        const sc = Array.isArray(b.selectedCategories) ? b.selectedCategories : [];
        if (ss.length > 0 || sc.length === 0) {
          log.migration.skipped++;
          continue;
        }
        try {
          const info = tournamentMap.get(String(b.tournamentId));
          const sportSelections = sc.map((c) => ({
            sportId: info?.sportId || null,
            sportName: info?.sportName || null,
            categoryName: c.name,
            fee: Number(c.price ?? 0),
          }));
          const totalFee =
            sportSelections.reduce((s, x) => s + Number(x.fee || 0), 0)
            || Number(b.paymentAmount || 0);

          if (DRY_RUN) {
            log.migration.touched++;
          } else {
            // Use updateOne (no Mongoose validation re-run on existing docs).
            await Booking.updateOne(
              { _id: b._id },
              { $set: { sportSelections, totalFee } }
            );
            log.migration.touched++;
          }
        } catch (err) {
          log.migration.errors++;
          log.errors.push({
            bookingId: String(b._id),
            error: err.message,
          });
        }
      }
    }

    console.log(`[VERIFY-BOOKING] Migration: touched=${log.migration.touched}, skipped=${log.migration.skipped}, errors=${log.migration.errors}`);
  }

  // ------------------------------------------------------------
  // Wrap up
  // ------------------------------------------------------------
  log.completedAt = new Date().toISOString();
  const logPath = path.join(__dirname, "verify-booking-migration.log");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\n[VERIFY-BOOKING] Log written to ${logPath}`);

  if (log.audit.legacyOnly > 0) {
    console.log(`\n[VERIFY-BOOKING] ⚠️  ${log.audit.legacyOnly} bookings still have only legacy selectedCategories.`);
    console.log(`[VERIFY-BOOKING]    Review log file, then run with --migrate --dry-run, then --migrate.`);
  }
  if (log.audit.totalFeeMismatch > 0) {
    console.log(`\n[VERIFY-BOOKING] ⚠️  ${log.audit.totalFeeMismatch} migrated bookings have totalFee != sum(sportSelections.fee).`);
    console.log(`[VERIFY-BOOKING]    Inspect the totalFeeMismatchSamples in the log file. Manual fix may be required.`);
  }
  if (log.audit.missingTotalFee > 0) {
    console.log(`\n[VERIFY-BOOKING] ⚠️  ${log.audit.missingTotalFee} migrated bookings have no totalFee value.`);
  }

  await mongoose.disconnect();
  console.log(`\n[VERIFY-BOOKING] Done.`);
}

main().catch((err) => {
  console.error("[VERIFY-BOOKING] FATAL:", err);
  process.exit(1);
});
