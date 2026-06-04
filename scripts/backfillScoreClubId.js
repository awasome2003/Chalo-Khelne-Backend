/**
 * Backfill Score.clubId (Phase 1.1 multi-tenancy).
 *
 * Score.matchId references a match document, but matches live across SEVERAL
 * collections (group-stage "Match", KnockoutMatch, DirectKnockoutMatch,
 * SuperMatch, TeamKnockoutMatches, Semifinals, TournamentMatch). So we build a
 * UNION map matchId → clubId from all of them (all already backfilled) and stamp
 * each Score from its match's clubId.
 *
 * Idempotent — only touches scores without a clubId.
 *
 * Usage:
 *   node scripts/backfillScoreClubId.js            # apply
 *   node scripts/backfillScoreClubId.js --dry-run  # report only
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Score = require("../Modal/Score");

const MATCH_MODELS = [
  require("../Modal/Tournnamentmatch"), // "Match"
  require("../Modal/TournamentMatch"),
  require("../Modal/KnockoutMatch"),
  require("../Modal/DirectKnockoutMatch"),
  require("../Modal/SuperMatch"),
  require("../Modal/TeamKnockoutMatches"),
  require("../Modal/semifinal"), // "Semifinals"
];

const DRY_RUN = process.argv.includes("--dry-run");
const MISSING = { $or: [{ clubId: null }, { clubId: { $exists: false } }] };

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  // Build union matchId(string) → clubId(ObjectId) from every match collection.
  const matchClub = new Map();
  for (const M of MATCH_MODELS) {
    const rows = await M.find({ clubId: { $ne: null } }).select("_id clubId").lean();
    for (const r of rows) matchClub.set(String(r._id), r.clubId);
  }
  console.log(`Match→club map built from ${MATCH_MODELS.length} collections: ${matchClub.size} matches with a clubId.`);

  // Group scores-needing-clubId by resolved clubId, then updateMany per club.
  const scores = await Score.find(MISSING).select("_id matchId").lean();
  console.log(`Scores missing clubId: ${scores.length}`);

  const byClub = new Map(); // clubId(string) → { clubId, ids: [] }
  let unresolved = 0;
  for (const s of scores) {
    const club = matchClub.get(String(s.matchId));
    if (!club) { unresolved++; continue; }
    const k = String(club);
    if (!byClub.has(k)) byClub.set(k, { clubId: club, ids: [] });
    byClub.get(k).ids.push(s._id);
  }

  let updated = 0;
  for (const { clubId, ids } of byClub.values()) {
    if (DRY_RUN) {
      updated += ids.length;
    } else {
      const r = await Score.updateMany({ _id: { $in: ids } }, { $set: { clubId } });
      updated += r.modifiedCount || 0;
    }
  }

  console.log(`\nDone. ${DRY_RUN ? "would update" : "updated"}=${updated}  unresolved=${unresolved}`);
  if (unresolved > 0) {
    console.warn(`⚠ ${unresolved} score(s) reference a match with no clubId (match deleted / orphan) — inert under enforcement.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
