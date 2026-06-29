// server/scripts/migrateToMultiSport.js
//
// One-shot, idempotent migration from single-sport (root scalars on
// Tournament) to multi-sport (Tournament.sports[] + sportId on every
// child doc). Safe to re-run.
//
// Usage:
//   node server/scripts/migrateToMultiSport.js [--dry-run]
//
// IMPORTANT: take the API offline before running for real (no concurrent
// writes during migration). Run --dry-run first; review the log; then
// run for real.
//
// Order of operations:
//   1. Tournaments — populate sports[0] from root scalars; create placeholder
//      Sport docs for unresolvable sportsType values.
//   2-8. Backfill sportId on BookingGroup, Match, KnockoutMatch, SuperMatch,
//      DirectKnockoutMatch, TopPlayers, SuperPlayers via per-tournament
//      updateMany.
//   9. GroupStandings — sportId mirrors the BookingGroup it references,
//      batched per tournament (one BookingGroup find + one bulkWrite per
//      tournament; not per standings doc).
//  10. TopPlayers seeded groupId rewrite — seeded_<cat> → seeded_<sportSlug>_<cat>.
//  11. Bookings — backfill sportSelections[] + totalFee from legacy
//      selectedCategories[].

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
if (!loadedEnv) dotenv.config();
const mongoose = require("mongoose");

const DRY_RUN = process.argv.includes("--dry-run");
const slugify = (s) => String(s || "").toLowerCase().replace(/\s+/g, "_");
const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("[MIGRATION] MONGO_URI not set in env. Aborting.");
    process.exit(1);
  }

  const tag = DRY_RUN ? "[DRY-RUN]" : "[REAL]";
  console.log(`\n[MIGRATION] ${tag} starting at ${new Date().toISOString()}`);
  if (loadedEnv) console.log(`[MIGRATION] Loaded env from: ${loadedEnv}`);
  console.log(`[MIGRATION] Connecting to MongoDB...`);
  await mongoose.connect(uri);

  // Lazy-require models AFTER connection so index creation is bound to this run.
  const Tournament = require("../src/modules/tournaments/models/Tournament");
  const Sport = require("../src/modules/catalog/models/Sport");
  const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
  const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
  const KnockoutMatch = require("../src/modules/tournaments/models/KnockoutMatch");
  const SuperMatch = require("../src/modules/tournaments/models/SuperMatch");
  const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
  const TopPlayers = require("../src/modules/tournaments/models/TopPlayers");
  const SuperPlayers = require("../src/modules/tournaments/models/SuperPlayers");
  const GroupStandings = require("../src/modules/tournaments/models/GroupStandings");
  const Booking = require("../src/modules/tournaments/models/BookingModel");

  const log = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    results: {},
    placeholders: [],
    errors: [],
  };

  // Pre-cache Sport docs by lowercased name.
  const sportDocs = await Sport.find({}).lean();
  const sportCache = new Map(sportDocs.map((s) => [String(s.name || "").toLowerCase(), s]));
  console.log(`[MIGRATION] Loaded ${sportDocs.length} Sport docs into cache.`);

  // ------------------------------------------------------------
  // 1. TOURNAMENTS — populate sports[0]
  // ------------------------------------------------------------
  log.results.tournaments = { touched: 0, skipped: 0, errors: 0, placeholdersCreated: 0 };
  const allTournaments = await Tournament.find({});
  for (const t of allTournaments) {
    try {
      if (Array.isArray(t.sports) && t.sports.length > 0) {
        log.results.tournaments.skipped++;
        continue;
      }

      // Resolve sport: cache → fuzzy regex → placeholder.
      const nameKey = String(t.sportsType || "").toLowerCase();
      let sportDoc = sportCache.get(nameKey);
      if (!sportDoc && t.sportsType) {
        sportDoc = await Sport.findOne({
          name: { $regex: new RegExp("^" + escapeRegex(t.sportsType) + "$", "i") },
        }).lean();
        if (sportDoc) sportCache.set(nameKey, sportDoc);
      }
      if (!sportDoc && t.sportsType) {
        if (DRY_RUN) {
          log.placeholders.push({
            action: "would_create",
            name: t.sportsType,
            tournamentId: String(t._id),
          });
        } else {
          const created = await Sport.create({
            name: t.sportsType,
            slug: slugify(t.sportsType),
            category: "Custom",
            scoringType: t.matchFormat?.scoringType || "sets",
          });
          sportDoc = created.toObject ? created.toObject() : created;
          sportCache.set(nameKey, sportDoc);
          log.placeholders.push({
            action: "created",
            name: t.sportsType,
            sportId: String(sportDoc._id),
            tournamentId: String(t._id),
          });
          log.results.tournaments.placeholdersCreated++;
        }
      }

      const matchFormatObj = t.matchFormat ? (t.matchFormat.toObject?.() || t.matchFormat) : null;
      const sportRulesObj = t.sportRules ? (t.sportRules.toObject?.() || t.sportRules) : null;
      const categoriesObj = Array.isArray(t.category)
        ? t.category.map((c) => ({ name: c.name, fee: c.fee }))
        : [];
      const stageConfigObj = t.stageConfig ? (t.stageConfig.toObject?.() || t.stageConfig) : {};

      // Map any legacy currentStage values that the new sportTrackSchema
      // enum doesn't accept. Most natural translation:
      //   qualifier_knockout → knockout (single playoff bracket).
      // Anything else not in the enum falls back to "registration".
      const ALLOWED_STAGES = new Set([
        "registration",
        "group_stage",
        "group_completed",
        "knockout",
        "completed",
      ]);
      const STAGE_ALIASES = { qualifier_knockout: "knockout" };
      const rawStage = t.currentStage || "registration";
      const mappedStage = STAGE_ALIASES[rawStage]
        || (ALLOWED_STAGES.has(rawStage) ? rawStage : "registration");

      const track = {
        sportId: sportDoc?._id || null,
        sportName: t.sportsType || sportDoc?.name || null,
        sportSlug: sportDoc?.slug || (t.sportsType ? slugify(t.sportsType) : null),
        type: t.type || null,
        categories: categoriesObj,
        groupStageFormat: t.groupStageFormat || null,
        knockoutFormat: t.knockoutFormat || null,
        davisCupFormatId: t.davisCupFormatId || null,
        qualifyPerGroup: t.qualifyPerGroup ?? 2,
        drawSize: t.drawSize ?? null,
        matchFormat: matchFormatObj,
        currentStage: mappedStage,
        stageConfig: stageConfigObj,
      };
      // Omit sportRules entirely when the source is null/missing —
      // assigning null fails Mongoose's subdocument cast. Letting the
      // schema default kick in is the correct behavior.
      if (sportRulesObj) {
        track.sportRules = sportRulesObj;
      }

      if (!DRY_RUN) {
        // Use updateOne($set) instead of doc.save() to bypass Mongoose's
        // subdocument cast layer. With doc.save(), the inline schema for
        // `sports[].sportRules` and the root `tournament.sportRules` share
        // path handling — when the root field is literally `null` (legacy
        // data), Mongoose injects that null into the new sports[0].sportRules
        // during subdoc construction and the Object cast fails, even though
        // our `track` object intentionally omits the field. updateOne writes
        // exactly the document we built — no internal cast pass.
        await Tournament.updateOne(
          { _id: t._id },
          { $set: { sports: [track] } }
        );
      }
      log.results.tournaments.touched++;
    } catch (err) {
      log.results.tournaments.errors++;
      log.errors.push({ collection: "tournaments", id: String(t._id), error: err.message });
    }
  }
  console.log(
    `[MIGRATION] tournaments: ${log.results.tournaments.touched} touched, ` +
    `${log.results.tournaments.skipped} skipped, ` +
    `${log.results.tournaments.errors} errors, ` +
    `${log.results.tournaments.placeholdersCreated} placeholder Sports created.`
  );

  // Build (tournamentId → { sportId, sportSlug, sportName }) map for downstream passes.
  // In dry-run, sports[] hasn't actually been written, so reconstruct from root
  // scalars + cache to mirror what the real run would produce.
  const tournamentMap = new Map();
  if (DRY_RUN) {
    for (const t of allTournaments) {
      const sportDoc = sportCache.get(String(t.sportsType || "").toLowerCase());
      tournamentMap.set(String(t._id), {
        sportId: sportDoc?._id || null,
        sportSlug: sportDoc?.slug || (t.sportsType ? slugify(t.sportsType) : null),
        sportName: t.sportsType || sportDoc?.name || null,
      });
    }
  } else {
    const tournamentsAfter = await Tournament.find({}, "_id sports sportsType").lean();
    for (const t of tournamentsAfter) {
      tournamentMap.set(String(t._id), {
        sportId: t.sports?.[0]?.sportId || null,
        sportSlug: t.sports?.[0]?.sportSlug || (t.sportsType ? slugify(t.sportsType) : null),
        sportName: t.sports?.[0]?.sportName || t.sportsType || null,
      });
    }
  }

  // Per-tournament updateMany helper for sportId backfill.
  async function backfillSportId(Model, label) {
    log.results[label] = { touched: 0, skipped: 0, errors: 0 };
    for (const [tournamentId, info] of tournamentMap.entries()) {
      if (!info.sportId) {
        // Tournament's sport unresolvable — log once via placeholders, skip downstream.
        continue;
      }
      try {
        if (DRY_RUN) {
          const wouldTouch = await Model.countDocuments({ tournamentId, sportId: null });
          log.results[label].touched += wouldTouch;
        } else {
          const r = await Model.updateMany(
            { tournamentId, sportId: null },
            { $set: { sportId: info.sportId } }
          );
          log.results[label].touched += r.modifiedCount || 0;
        }
      } catch (err) {
        log.results[label].errors++;
        log.errors.push({ collection: label, tournamentId, error: err.message });
      }
    }
    console.log(
      `[MIGRATION] ${label}: ${log.results[label].touched} touched, ${log.results[label].errors} errors.`
    );
  }

  // ------------------------------------------------------------
  // 2-8. BACKFILL sportId
  // ------------------------------------------------------------
  await backfillSportId(BookingGroup, "bookingGroups");
  await backfillSportId(Match, "matches");
  await backfillSportId(KnockoutMatch, "knockoutMatches");
  await backfillSportId(SuperMatch, "superMatches");
  await backfillSportId(DirectKnockoutMatch, "directKnockoutMatches");
  await backfillSportId(TopPlayers, "topPlayers");
  await backfillSportId(SuperPlayers, "superPlayers");

  // ------------------------------------------------------------
  // 9. GROUP STANDINGS — sportId from BookingGroup (batched per tournament)
  // ------------------------------------------------------------
  // Per STEP 9d note: load all BookingGroups for a tournament once, build a
  // groupId→sportId map, then bulkWrite. One find + one bulkWrite per
  // tournament — not N queries per standings doc.
  log.results.groupStandings = { touched: 0, skipped: 0, errors: 0 };
  for (const [tournamentId] of tournamentMap.entries()) {
    try {
      const standings = await GroupStandings
        .find({ tournamentId, sportId: null })
        .select("_id groupId")
        .lean();
      if (standings.length === 0) continue;

      const groupIds = standings.map((s) => s.groupId);
      const groups = await BookingGroup
        .find({ _id: { $in: groupIds } })
        .select("_id sportId")
        .lean();
      const groupSportMap = new Map(groups.map((g) => [String(g._id), g.sportId]));

      const ops = [];
      for (const s of standings) {
        const sportId = groupSportMap.get(String(s.groupId));
        if (!sportId) continue;
        ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { sportId } } } });
      }
      if (ops.length === 0) continue;

      if (DRY_RUN) {
        log.results.groupStandings.touched += ops.length;
      } else {
        const r = await GroupStandings.bulkWrite(ops);
        log.results.groupStandings.touched += r.modifiedCount || ops.length;
      }
    } catch (err) {
      log.results.groupStandings.errors++;
      log.errors.push({ collection: "groupStandings", tournamentId, error: err.message });
    }
  }
  console.log(
    `[MIGRATION] groupStandings: ${log.results.groupStandings.touched} touched, ${log.results.groupStandings.errors} errors.`
  );

  // ------------------------------------------------------------
  // 10. TOPPLAYERS seeded groupId rewrite
  // ------------------------------------------------------------
  log.results.topPlayersGroupIdRewrite = { touched: 0, skipped: 0, errors: 0 };
  const seededDocs = await TopPlayers.find({ groupId: /^seeded_/ });
  for (const doc of seededDocs) {
    try {
      const info = tournamentMap.get(String(doc.tournamentId));
      if (!info?.sportSlug) {
        log.results.topPlayersGroupIdRewrite.skipped++;
        continue;
      }
      const remainder = String(doc.groupId).slice("seeded_".length);
      // Already-migrated check: starts with our sport slug + "_". Uses literal
      // prefix matching so category slugs containing underscores (e.g. "u_18")
      // are handled correctly.
      if (remainder.startsWith(info.sportSlug + "_")) {
        log.results.topPlayersGroupIdRewrite.skipped++;
        continue;
      }
      const newGroupId = `seeded_${info.sportSlug}_${remainder}`;
      if (DRY_RUN) {
        log.results.topPlayersGroupIdRewrite.touched++;
      } else {
        doc.groupId = newGroupId;
        await doc.save({ validateModifiedOnly: true });
        log.results.topPlayersGroupIdRewrite.touched++;
      }
    } catch (err) {
      log.results.topPlayersGroupIdRewrite.errors++;
      log.errors.push({ collection: "topPlayersGroupIdRewrite", id: String(doc._id), error: err.message });
    }
  }
  console.log(
    `[MIGRATION] topPlayersGroupIdRewrite: ${log.results.topPlayersGroupIdRewrite.touched} touched, ` +
    `${log.results.topPlayersGroupIdRewrite.skipped} skipped, ${log.results.topPlayersGroupIdRewrite.errors} errors.`
  );

  // ------------------------------------------------------------
  // 11. BOOKINGS — backfill sportSelections[] + totalFee
  // ------------------------------------------------------------
  log.results.bookings = { touched: 0, skipped: 0, errors: 0 };
  const bookingsToMigrate = await Booking.find({
    $or: [
      { sportSelections: { $exists: false } },
      { sportSelections: { $size: 0 } },
    ],
  });
  for (const b of bookingsToMigrate) {
    try {
      if (!Array.isArray(b.selectedCategories) || b.selectedCategories.length === 0) {
        log.results.bookings.skipped++;
        continue;
      }
      const info = tournamentMap.get(String(b.tournamentId));
      const sportSelections = b.selectedCategories.map((c) => ({
        sportId: info?.sportId || null,
        sportName: info?.sportName || null,
        categoryName: c.name,
        fee: Number(c.price ?? 0),
      }));
      const totalFee = sportSelections.reduce((s, sel) => s + Number(sel.fee || 0), 0)
        || Number(b.paymentAmount || 0);
      if (DRY_RUN) {
        log.results.bookings.touched++;
      } else {
        b.sportSelections = sportSelections;
        b.totalFee = totalFee;
        await b.save({ validateModifiedOnly: true });
        log.results.bookings.touched++;
      }
    } catch (err) {
      log.results.bookings.errors++;
      log.errors.push({ collection: "bookings", id: String(b._id), error: err.message });
    }
  }
  console.log(
    `[MIGRATION] bookings: ${log.results.bookings.touched} touched, ${log.results.bookings.skipped} skipped, ${log.results.bookings.errors} errors.`
  );

  // ------------------------------------------------------------
  // Wrap up
  // ------------------------------------------------------------
  log.completedAt = new Date().toISOString();
  const logPath = path.join(__dirname, "migration-multi-sport.log");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log(`\n[MIGRATION] Summary ${tag}:`);
  for (const [k, v] of Object.entries(log.results)) {
    const extras = v.placeholdersCreated ? `, placeholderSports=${v.placeholdersCreated}` : "";
    console.log(`  ${k.padEnd(28)} touched=${v.touched}, skipped=${v.skipped}, errors=${v.errors}${extras}`);
  }
  if (log.placeholders.length) {
    console.log(`\n[MIGRATION] Placeholder Sports (${log.placeholders.length}):`);
    for (const p of log.placeholders.slice(0, 5)) {
      console.log(`  - ${p.action}: ${p.name} (tournament: ${p.tournamentId})`);
    }
    if (log.placeholders.length > 5) console.log(`  ... and ${log.placeholders.length - 5} more (see log file).`);
  }
  if (log.errors.length) {
    console.log(`\n[MIGRATION] Errors: ${log.errors.length} — see log file for details.`);
  }
  console.log(`\n[MIGRATION] Log written to ${logPath}`);

  await mongoose.disconnect();
  console.log(`[MIGRATION] Disconnected. ${tag} done.`);
}

main().catch((err) => {
  console.error("[MIGRATION] FATAL:", err);
  process.exit(1);
});
