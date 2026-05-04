#!/usr/bin/env node
/**
 * Diagnostic: Top-Players coverage for the Summer Championship's
 * Table Tennis sport. Read-only — no writes.
 *
 * Reports:
 *   - Per-sport qualifyPerGroup (where the field actually lives in the doc)
 *   - List of BookingGroups for the sport, with player counts
 *   - Per-group match completion status
 *   - GroupStandings presence per group
 *   - TopPlayers docs for the sport — groupIds and player counts
 *   - Computed expected count vs actual TopPlayers total
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Tournament = require("../Modal/Tournament");
const BookingGroup = require("../Modal/bookinggroup");
const Match = require("../Modal/Tournnamentmatch");
const TopPlayers = require("../Modal/TopPlayers");
const GroupStandings = require("../Modal/GroupStandings");

const TOURNAMENT_ID = "69f340cfb16abf19e2875e52";
const SPORT_NAME = "Table Tennis";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to MongoDB\n");

  const t = await Tournament.findById(TOURNAMENT_ID).lean();
  if (!t) { console.error(`Tournament ${TOURNAMENT_ID} not found`); process.exit(1); }

  console.log(`Tournament: ${t.title} (${t._id})\n`);

  // ── Q4: which doc carries qualifyPerGroup?
  const sport = (t.sports || []).find((s) => s.sportName === SPORT_NAME);
  if (!sport) { console.error(`Sport "${SPORT_NAME}" not found on tournament`); process.exit(1); }

  console.log("─".repeat(60));
  console.log("Q4 — qualifyPerGroup source check");
  console.log("─".repeat(60));
  console.log(`  per-sport (sports[i].qualifyPerGroup):  ${sport.qualifyPerGroup}`);
  console.log(`  legacy root (t.qualifyPerGroup):        ${t.qualifyPerGroup ?? "(undefined)"}`);
  console.log(`  active stage (sports[i].currentStage):  ${sport.currentStage}`);
  console.log(`  type:                                   ${sport.type}`);
  console.log(`  groupStageFormat:                       ${sport.groupStageFormat}`);
  console.log(`  knockoutFormat:                         ${sport.knockoutFormat}`);
  console.log("");

  // ── Q1: groups for this sport, with player counts
  console.log("─".repeat(60));
  console.log(`Q1 — BookingGroups for ${SPORT_NAME}`);
  console.log("─".repeat(60));
  const groups = await BookingGroup.find({ tournamentId: TOURNAMENT_ID, sportId: sport.sportId }).lean();
  console.log(`  Total groups: ${groups.length}`);
  for (const g of groups) {
    const playerCount = (g.players || []).length;
    const flag = playerCount < (sport.qualifyPerGroup || 2) ? "  ⚠ smaller than qualifyPerGroup" : "";
    console.log(`    • ${(g.groupName || "(no name)").padEnd(20)} ${String(playerCount).padStart(2)} players${flag}  (${g._id})`);
  }
  console.log("");

  // ── Q2: per-group match completion + standings presence
  console.log("─".repeat(60));
  console.log("Q2 — Match completion + standings per group");
  console.log("─".repeat(60));
  let totalMatches = 0, totalCompleted = 0, groupsAllDone = 0;
  for (const g of groups) {
    const matches = await Match.find({ tournamentId: TOURNAMENT_ID, groupId: g._id }).select("status").lean();
    const total = matches.length;
    const completed = matches.filter((m) => (m.status || "").toUpperCase() === "COMPLETED").length;
    totalMatches += total;
    totalCompleted += completed;
    const allDone = total > 0 && completed === total;
    if (allDone) groupsAllDone++;
    const standing = await GroupStandings.findOne({ tournamentId: TOURNAMENT_ID, groupId: g._id }).lean();
    const standingsCount = standing ? (standing.standings || []).length : 0;
    const standingsFinalized = standing?.isFinalized ? "finalized" : (standing ? "exists, not finalized" : "missing");
    console.log(`    • ${(g.groupName || "(no name)").padEnd(20)} ${String(completed).padStart(2)}/${String(total).padStart(2)} matches done   standings: ${standingsCount} entries (${standingsFinalized})`);
  }
  console.log("");
  console.log(`  Totals: ${totalCompleted}/${totalMatches} matches done · ${groupsAllDone}/${groups.length} groups complete`);
  console.log("");

  // ── Q3: TopPlayers docs for this sport
  console.log("─".repeat(60));
  console.log(`Q3 — TopPlayers docs for sportId=${sport.sportId}`);
  console.log("─".repeat(60));
  const tps = await TopPlayers.find({ tournamentId: TOURNAMENT_ID, sportId: sport.sportId }).lean();
  console.log(`  Total TopPlayers docs: ${tps.length}`);
  let totalTopPlayers = 0;
  const groupIdsCovered = new Set();
  for (const tp of tps) {
    const list = (tp.players && tp.players.length > 0) ? tp.players : tp.topPlayers;
    const count = (list || []).length;
    totalTopPlayers += count;
    groupIdsCovered.add(String(tp.groupId));
    const isSynthetic = !mongoose.Types.ObjectId.isValid(String(tp.groupId));
    console.log(`    • ${(tp.groupName || "(no name)").padEnd(35)} ${String(count).padStart(2)} players  groupId=${tp.groupId}${isSynthetic ? "  (synthetic/seeded)" : ""}`);
  }
  console.log("");
  console.log(`  Total players across all TopPlayers docs: ${totalTopPlayers}`);
  console.log("");

  // ── Coverage cross-check: which groups DON'T have a TopPlayers doc?
  const realGroupIds = new Set(groups.map((g) => String(g._id)));
  const groupsMissingTopPlayers = [...realGroupIds].filter((id) => !groupIdsCovered.has(id));
  if (groupsMissingTopPlayers.length > 0) {
    console.log("─".repeat(60));
    console.log("⚠  Groups MISSING from TopPlayers");
    console.log("─".repeat(60));
    for (const gid of groupsMissingTopPlayers) {
      const g = groups.find((x) => String(x._id) === gid);
      console.log(`    • ${g?.groupName || "(no name)"}  (${gid})`);
    }
    console.log("");
  }

  // ── Final reckoning
  console.log("═".repeat(60));
  console.log("Summary");
  console.log("═".repeat(60));
  console.log(`  Expected (groups × qualifyPerGroup):  ${groups.length} × ${sport.qualifyPerGroup} = ${groups.length * sport.qualifyPerGroup}`);
  console.log(`  Actual TopPlayers count:              ${totalTopPlayers}`);
  console.log(`  Delta:                                ${groups.length * sport.qualifyPerGroup - totalTopPlayers}`);
  console.log("");

  await mongoose.disconnect();
}

main().catch((err) => { console.error("Diagnostic failed:", err); process.exit(1); });
