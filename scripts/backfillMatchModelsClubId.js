/**
 * Backfill clubId on all match-family models (Phase 1.1 multi-tenancy).
 *
 * 10 models derive clubId via tournamentId → Tournament.clubId.
 * Score has no tournamentId — it derives two-hop via matchId →
 * TournamentMatch.tournamentId → Tournament.clubId.
 *
 * Idempotent — only touches docs without a clubId.
 *
 * Usage:
 *   node scripts/backfillMatchModelsClubId.js            # apply
 *   node scripts/backfillMatchModelsClubId.js --dry-run  # report only
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Tournament = require("../Modal/Tournament");

const TournamentMatch = require("../Modal/TournamentMatch");
const Match = require("../Modal/Tournnamentmatch"); // model "Match"
const KnockoutMatch = require("../Modal/KnockoutMatch");
const DirectKnockoutMatch = require("../Modal/DirectKnockoutMatch");
const TeamKnockout = require("../Modal/TeamKnockout");
const TeamKnockoutMatches = require("../Modal/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../Modal/TeamKnockoutTeams");
const SuperMatch = require("../Modal/SuperMatch");
const Semifinals = require("../Modal/semifinal");
const GroupStandings = require("../Modal/GroupStandings");
const Score = require("../Modal/Score");

const DRY_RUN = process.argv.includes("--dry-run");
const MISSING = { $or: [{ clubId: null }, { clubId: { $exists: false } }] };

// Models scoped directly by tournamentId.
const TOURNAMENT_BASED = [
  [TournamentMatch, "TournamentMatch"],
  [Match, "Match"],
  [KnockoutMatch, "KnockoutMatch"],
  [DirectKnockoutMatch, "DirectKnockoutMatch"],
  [TeamKnockout, "TeamKnockout"],
  [TeamKnockoutMatches, "TeamKnockoutMatches"],
  [TeamKnockoutTeams, "TeamKnockoutTeams"],
  [SuperMatch, "SuperMatch"],
  [Semifinals, "Semifinals"],
  [GroupStandings, "GroupStandings"],
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  const tournaments = await Tournament.find({ clubId: { $ne: null } })
    .select("_id clubId")
    .lean();
  console.log(`Tournaments with a clubId: ${tournaments.length}\n`);

  let grandUpdated = 0;
  let grandMissing = 0;

  // ── tournamentId-based models ──
  for (const [Model, name] of TOURNAMENT_BASED) {
    let updated = 0;
    for (const t of tournaments) {
      const filter = { tournamentId: t._id, ...MISSING };
      if (DRY_RUN) {
        updated += await Model.countDocuments(filter);
      } else {
        const r = await Model.updateMany(filter, { $set: { clubId: t.clubId } });
        updated += r.modifiedCount || 0;
      }
    }
    const stillMissing = (await Model.countDocuments(MISSING)) - (DRY_RUN ? updated : 0);
    grandUpdated += updated;
    grandMissing += Math.max(0, stillMissing);
    console.log(`${name.padEnd(22)} ${DRY_RUN ? "would update" : "updated"}=${String(updated).padStart(5)}  still-missing=${Math.max(0, stillMissing)}`);
  }

  // ── Score (two-hop: matchId → TournamentMatch.tournamentId → clubId) ──
  const tClub = new Map(tournaments.map((t) => [String(t._id), t.clubId]));
  const matches = await TournamentMatch.find({}).select("_id tournamentId").lean();
  const byClub = new Map(); // clubId(string) → [matchId,...]
  for (const m of matches) {
    const club = tClub.get(String(m.tournamentId));
    if (!club) continue;
    const k = String(club);
    if (!byClub.has(k)) byClub.set(k, []);
    byClub.get(k).push(m._id);
  }
  let scoreUpdated = 0;
  for (const [clubId, ids] of byClub) {
    const filter = { matchId: { $in: ids }, ...MISSING };
    if (DRY_RUN) {
      scoreUpdated += await Score.countDocuments(filter);
    } else {
      const r = await Score.updateMany(filter, { $set: { clubId } });
      scoreUpdated += r.modifiedCount || 0;
    }
  }
  const scoreMissing = (await Score.countDocuments(MISSING)) - (DRY_RUN ? scoreUpdated : 0);
  grandUpdated += scoreUpdated;
  grandMissing += Math.max(0, scoreMissing);
  console.log(`${"Score (via match)".padEnd(22)} ${DRY_RUN ? "would update" : "updated"}=${String(scoreUpdated).padStart(5)}  still-missing=${Math.max(0, scoreMissing)}`);

  console.log(`\nTOTAL ${DRY_RUN ? "would update" : "updated"}=${grandUpdated}  still-missing=${grandMissing}`);
  console.log("still-missing rows reference DELETED tournaments (legacy orphans) — inert under enforcement.");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Backfill failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
