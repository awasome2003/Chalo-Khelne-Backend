/**
 * Audit group-stage match types against the format each category should use.
 * READ ONLY by default — no writes without both --repair and --confirm.
 *
 * Why this exists
 * ---------------
 * matchController's group-stage generator is the only place that decides
 * singles vs doubles, and it used to resolve the format from the SPORT track
 * alone, ignoring which category the group belonged to:
 *
 *     getGroupStageFormat(tournament, group.sportId) === "Doubles"
 *
 * That produced two classes of wrong fixture:
 *
 *   • a track set to "Doubles" generated DOUBLES matches for every category,
 *     including Men's Singles and Women's Singles;
 *   • a track set to the combined "Singles, Doubles" failed the strict
 *     equality and generated SINGLES matches for every doubles category.
 *
 * The generator now resolves per category, but fixtures created before that
 * are still in the database. This script finds them.
 *
 * Classification
 * --------------
 *   OK        matchType agrees with the resolved format
 *   SAFE      disagrees, and not one match in the group has been touched —
 *             safe to delete so the manager can regenerate from the UI
 *   BLOCKED   disagrees, but play has started or finished — never touched
 *             here; re-pairing players after results exist is a decision for
 *             whoever ran the event, not for a script
 *   UNKNOWN   the format could not be resolved, or the group's `category`
 *             matches no category on the tournament — so the format is a
 *             guess. Reported, never repaired.
 *
 * A group is "touched" if any of its matches is IN_PROGRESS/COMPLETED/
 * CANCELLED, carries a matchResult or a legacy result winner, or has any set
 * recorded. Anything ambiguous counts as touched.
 *
 * Usage:
 *   node scripts/auditGroupMatchTypes.js
 *   node scripts/auditGroupMatchTypes.js --tournament <tournamentId>
 *   node scripts/auditGroupMatchTypes.js --repair              # dry run
 *   node scripts/auditGroupMatchTypes.js --repair --confirm    # deletes
 *
 * --repair only ever deletes matches belonging to SAFE groups. The groups
 * themselves, their players and every BLOCKED group are left alone.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const Tournament = require("../src/modules/tournaments/models/Tournament");
const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
const Match = require("../src/modules/tournaments/models/Tournnamentmatch");
const { getGroupStageFormat, getSportTrack, getCategory } = require("../utils/sportTrackUtils");

const argv = process.argv.slice(2);
const REPAIR = argv.includes("--repair");
const CONFIRM = argv.includes("--confirm");
const tournamentArg = (() => {
  const i = argv.indexOf("--tournament");
  return i !== -1 ? argv[i + 1] : null;
})();

// Conservative: anything that is not a pristine SCHEDULED match with no
// recorded state counts as played.
function isTouched(match) {
  if (!match) return true;
  if (match.status && match.status !== "SCHEDULED") return true;
  if (match.matchResult) return true;
  if (match.result?.winner?.playerId || match.result?.winner?.playerName) return true;
  if (Array.isArray(match.sets) && match.sets.length > 0) return true;
  return false;
}

function pad(s, n) {
  return String(s ?? "").padEnd(n);
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${REPAIR && CONFIRM ? " (REPAIR MODE — will delete)" : " (read-only)"}.\n`);

  const tourFilter = tournamentArg ? { _id: tournamentArg } : {};
  const tournaments = await Tournament.find(tourFilter)
    .select("_id title sports")
    .lean();

  if (tournaments.length === 0) {
    console.log("No tournaments matched.");
    return;
  }

  const buckets = { OK: [], SAFE: [], BLOCKED: [], UNKNOWN: [] };
  // Groups that exist but have no fixtures yet. Nothing to audit, but they are
  // counted so the totals reconcile against the group count an operator sees.
  let notGenerated = 0;

  for (const tournament of tournaments) {
    const groups = await BookingGroup.find({ tournamentId: tournament._id })
      .select("_id groupName category sportId")
      .lean();
    if (groups.length === 0) continue;

    for (const group of groups) {
      const matches = await Match.find({ tournamentId: tournament._id, groupId: group._id })
        .select("_id matchType status matchResult result sets")
        .lean();
      if (matches.length === 0) {
        notGenerated++;
        continue;
      }

      const track = getSportTrack(tournament, group.sportId);
      const expectedFormat = getGroupStageFormat(tournament, group.sportId, group.category);
      const sportName = track?.sportName || "(unknown sport)";

      const row = {
        tournamentId: String(tournament._id),
        tournamentTitle: tournament.title,
        sportName,
        groupId: String(group._id),
        groupName: group.groupName,
        category: group.category || "(no category)",
        expected: expectedFormat,
        matchCount: matches.length,
      };

      if (!expectedFormat) {
        row.note = "no format could be resolved for this sport track";
        buckets.UNKNOWN.push(row);
        continue;
      }

      // Only trust the resolved format when the group's category actually
      // exists on the tournament. A group whose `category` matches no row is
      // resolved from the track (or from the name, on a combined track) —
      // a guess, and not a basis for deleting fixtures. Report, never repair.
      if (!getCategory(tournament, group.sportId, group.category)) {
        row.expectedType = expectedFormat === "Doubles" ? "doubles" : "singles";
        row.wrongCount = matches.filter(
          (m) => (m.matchType || "singles") !== row.expectedType
        ).length;
        row.note = group.category
          ? `category "${group.category}" is not on the tournament`
          : "group has no category";
        buckets.UNKNOWN.push(row);
        continue;
      }

      const expectedType = expectedFormat === "Doubles" ? "doubles" : "singles";
      const wrong = matches.filter((m) => (m.matchType || "singles") !== expectedType);
      row.expectedType = expectedType;
      row.wrongCount = wrong.length;

      if (wrong.length === 0) {
        buckets.OK.push(row);
        continue;
      }

      const touched = matches.filter(isTouched);
      row.touchedCount = touched.length;
      row.matchIds = matches.map((m) => m._id);
      buckets[touched.length > 0 ? "BLOCKED" : "SAFE"].push(row);
    }
  }

  // ── Report ────────────────────────────────────────────────────────
  const line = (r) =>
    "   " +
    pad(r.sportName, 15) +
    pad(r.category, 18) +
    // Group names are long in practice ("Mixed Doubles — League A").
    pad(r.groupName, 28) +
    pad(`expected=${r.expectedType ?? "?"}`, 18) +
    pad(`wrong=${r.wrongCount ?? "?"}/${r.matchCount}`, 14) +
    (r.touchedCount ? `played=${r.touchedCount}  ` : "") +
    (r.note || "");

  console.log(
    `Scanned ${tournaments.length} tournament(s): ` +
      `${buckets.OK.length} OK · ${buckets.SAFE.length} SAFE · ` +
      `${buckets.BLOCKED.length} BLOCKED · ${buckets.UNKNOWN.length} UNKNOWN` +
      (notGenerated
        ? `\n(${notGenerated} further group(s) have no fixtures generated yet — nothing to audit)`
        : "") +
      "\n"
  );

  // With a single tournament in scope the OK rows are the useful confirmation,
  // not noise — show them so the totals can be reconciled by eye.
  if (tournamentArg && buckets.OK.length > 0) {
    console.log(`OK (${buckets.OK.length} group(s)):`);
    buckets.OK.forEach((r) => console.log(line(r)));
    console.log("");
  }

  for (const key of ["SAFE", "BLOCKED", "UNKNOWN"]) {
    if (buckets[key].length === 0) continue;
    console.log(`${key} (${buckets[key].length} group(s)):`);
    let lastTournament = null;
    for (const r of buckets[key]) {
      if (r.tournamentId !== lastTournament) {
        console.log(`  ${r.tournamentTitle}  [${r.tournamentId}]`);
        lastTournament = r.tournamentId;
      }
      console.log(line(r));
    }
    console.log("");
  }

  if (buckets.BLOCKED.length > 0) {
    console.log(
      "BLOCKED groups have results recorded. Deleting their matches would destroy\n" +
        "scores, so this script never touches them — decide those by hand.\n"
    );
  }

  // ── Repair ────────────────────────────────────────────────────────
  if (!REPAIR) {
    if (buckets.SAFE.length > 0) {
      console.log("Re-run with --repair to see what would be deleted, then --repair --confirm to apply.");
    }
    return;
  }

  const deletableIds = buckets.SAFE.flatMap((r) => r.matchIds);
  if (deletableIds.length === 0) {
    console.log("Nothing safe to repair.");
    return;
  }

  if (!CONFIRM) {
    console.log(
      `DRY RUN — would delete ${deletableIds.length} match(es) across ` +
        `${buckets.SAFE.length} group(s). No group, player or booking is touched.\n` +
        "Managers regenerate the affected groups from the tournament UI afterwards.\n" +
        "Re-run with --repair --confirm to apply."
    );
    return;
  }

  const res = await Match.deleteMany({ _id: { $in: deletableIds } });
  console.log(
    `Deleted ${res.deletedCount} match(es) across ${buckets.SAFE.length} group(s).\n` +
      "Regenerate those groups from the tournament UI — the generator now resolves\n" +
      "the format per category, so the new fixtures will be correct."
  );
}

run()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
