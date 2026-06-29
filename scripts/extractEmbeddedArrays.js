/**
 * Phase 5 — extract unbounded embedded arrays into their own collections.
 *
 *   Tournament.whitelist[] → TournamentParticipant
 *   Turf.reviews[]         → TurfReview
 *   Post.comments[]        → PostComment
 *
 * SAFE + IDEMPOTENT + NON-DESTRUCTIVE:
 *  • Copies each embedded item into the new collection (skips items already
 *    migrated, so re-running is safe).
 *  • Then renames the source field to `<field>_backup` on the parent — the data
 *    is preserved (never dropped); the renamed field also marks the doc as
 *    migrated, so a second run skips it.
 *  • Does NOT touch any collection if the parent is already migrated.
 *
 * Run AFTER deploying the new models, BEFORE cutting the controllers over to the
 * new collections. Reads MONGO_URI from env.
 *
 *   node -r dotenv/config scripts/extractEmbeddedArrays.js
 *   node -r dotenv/config scripts/extractEmbeddedArrays.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");

const DRY = process.argv.includes("--dry-run");

const Tournament = require("../src/modules/tournaments/models/Tournament");
const Turf = require("../src/modules/org/models/Turf");
const Post = require("../src/modules/social/models/Post");
const TournamentParticipant = require("../src/modules/tournaments/models/TournamentParticipant");
const TurfReview = require("../src/modules/org/models/TurfReview");
const PostComment = require("../src/modules/social/models/PostComment");

// One spec per array. `map` turns an embedded item into a child doc.
const SPECS = [
  {
    label: "Tournament.whitelist → TournamentParticipant",
    Parent: Tournament,
    Child: TournamentParticipant,
    field: "whitelist",
    parentSelect: "whitelist clubId",
    map: (item, parent) => ({
      tournamentId: parent._id,
      clubId: parent.clubId || null,
      employeeId: item.employeeId || "",
      name: item.name || "",
      mobile: item.mobile || "",
    }),
    // dedupe key for idempotency at the item level
    childMatch: (item, parent) => ({ tournamentId: parent._id, employeeId: item.employeeId || "", mobile: item.mobile || "" }),
  },
  {
    label: "Turf.reviews → TurfReview",
    Parent: Turf,
    Child: TurfReview,
    field: "reviews",
    parentSelect: "reviews owner clubId",
    map: (item, parent) => ({
      turfId: parent._id,
      clubId: parent.clubId || parent.owner || null,
      user: item.user || null,
      rating: item.rating,
      comment: item.comment || "",
      createdAt: item.createdAt,
    }),
    childMatch: (item, parent) => ({ turfId: parent._id, user: item.user || null, createdAt: item.createdAt }),
  },
  {
    label: "Post.comments → PostComment",
    Parent: Post,
    Child: PostComment,
    field: "comments",
    parentSelect: "comments",
    map: (item, parent) => ({
      postId: parent._id,
      user: item.user || null,
      text: item.text || "",
      createdAt: item.createdAt,
    }),
    childMatch: (item, parent) => ({ postId: parent._id, user: item.user || null, text: item.text || "", createdAt: item.createdAt }),
  },
];

async function migrateSpec(spec) {
  const report = { label: spec.label, parents: 0, alreadyMigrated: 0, itemsCopied: 0, itemsSkipped: 0, failed: 0 };
  // Only parents that still have the original field (not yet renamed to _backup).
  const cursor = spec.Parent.collection.find({ [spec.field]: { $exists: true } });

  for await (const parent of cursor) {
    report.parents++;
    const items = Array.isArray(parent[spec.field]) ? parent[spec.field] : [];
    try {
      for (const item of items) {
        const match = spec.childMatch(item, parent);
        const exists = await spec.Child.collection.findOne(match);
        if (exists) { report.itemsSkipped++; continue; }
        if (!DRY) await spec.Child.collection.insertOne({ ...spec.map(item, parent), createdAt: spec.map(item, parent).createdAt || new Date(), updatedAt: new Date() });
        report.itemsCopied++;
      }
      // Rename the source field to _backup (non-destructive) — marks as migrated.
      if (!DRY) {
        await spec.Parent.collection.updateOne(
          { _id: parent._id },
          { $rename: { [spec.field]: `${spec.field}_backup` } }
        );
      }
    } catch (err) {
      report.failed++;
      console.error(`  [${spec.label}] failed on parent ${parent._id}: ${err.message}`);
    }
  }
  return report;
}

async function run() {
  if (!process.env.MONGO_URI) { console.error("FATAL: MONGO_URI not set."); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. ${DRY ? "DRY RUN — no writes.\n" : "\n"}`);

  const reports = [];
  for (const spec of SPECS) reports.push(await migrateSpec(spec));

  console.log("\n──────── MIGRATION REPORT ────────");
  console.log("model".padEnd(42) + "parents  copied  skipped  failed");
  for (const r of reports) {
    console.log(
      r.label.padEnd(42) +
        String(r.parents).padStart(7) +
        String(r.itemsCopied).padStart(8) +
        String(r.itemsSkipped).padStart(9) +
        String(r.failed).padStart(8)
    );
  }
  const totalFailed = reports.reduce((a, r) => a + r.failed, 0);
  console.log("──────────────────────────────────");
  console.log(totalFailed === 0 ? "✅ done, 0 failures" : `❌ ${totalFailed} failures — investigate before cutover`);

  await mongoose.disconnect();
  process.exit(totalFailed === 0 ? 0 : 1);
}

// Only run when invoked directly (node scripts/extractEmbeddedArrays.js), NEVER
// as a side effect of require() — so it's safe to load-check / unit-test.
if (require.main === module) {
  run().catch(async (err) => {
    console.error("Migration failed:", err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { run, SPECS };
