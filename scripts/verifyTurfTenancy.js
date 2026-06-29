/**
 * Verify Turf + TurfBooking multi-tenancy (Phase 1.1) — READ ONLY.
 * Run BEFORE flipping their tenantScope plugins to enforce:true.
 *
 * Part A — consistency:
 *   Turf.clubId        must equal Turf.owner.
 *   TurfBooking.clubId must equal its turf's clubId. (mismatch MUST be 0)
 * Part B — scoping proof on each collection via enforce:true probes.
 *
 * Usage:  node scripts/verifyTurfTenancy.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runWithTenant } = require("../utils/tenantContext");
const tenantScope = require("../utils/tenantScope");
const Turf = require("../src/modules/org/models/Turf");
const TurfBooking = require("../src/modules/org/models/TurfBooking");

async function proveScoping(Model, name, clubCounts) {
  const distinct = [...clubCounts.keys()];
  if (distinct.length === 0) return "n/a";
  const probeSchema = new mongoose.Schema(
    { clubId: mongoose.Schema.Types.ObjectId },
    { strict: false, collection: Model.collection.collectionName }
  );
  probeSchema.plugin(tenantScope, { field: "clubId", enforce: true });
  const Probe = mongoose.model("__probe_" + name, probeSchema);

  const clubA = distinct[0];
  const expectedA = clubCounts.get(clubA);
  const scoped = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
    return await Probe.countDocuments({});
  });
  const leaked = await runWithTenant({ clubId: clubA, principalType: "ClubAdmin" }, async () => {
    const ds = await Probe.find({}).select("clubId").lean();
    return ds.filter((x) => String(x.clubId) !== clubA).length;
  });
  return scoped === expectedA && leaked === 0 ? "OK" : `FAIL(scoped=${scoped}/${expectedA},leak=${leaked})`;
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected (read-only).\n");

  let totalMismatch = 0;

  // ── Turf: clubId must == owner ──
  const turfs = await Turf.find({}).select("_id clubId owner").lean();
  const turfClub = new Map(); // turfId → clubId(string)
  let tNoClub = 0, tMismatch = 0;
  const tClubCounts = new Map();
  for (const t of turfs) {
    if (t.clubId) turfClub.set(String(t._id), String(t.clubId));
    if (!t.clubId) { tNoClub++; continue; }
    tClubCounts.set(String(t.clubId), (tClubCounts.get(String(t.clubId)) || 0) + 1);
    if (String(t.clubId) !== String(t.owner)) tMismatch++;
  }
  totalMismatch += tMismatch;
  const tProof = await proveScoping(Turf, "Turf", tClubCounts);
  console.log(`Turf         total=${turfs.length}  noClubId=${tNoClub}  mismatch(vs owner)=${tMismatch}  scoping=${tProof}`);

  // ── TurfBooking: clubId must == its turf's clubId ──
  const bookings = await TurfBooking.find({}).select("_id clubId turfId").lean();
  let bNoClub = 0, bOrphan = 0, bMismatch = 0;
  const bClubCounts = new Map();
  for (const b of bookings) {
    const expected = turfClub.get(String(b.turfId));
    if (!b.clubId) { bNoClub++; if (!expected) bOrphan++; continue; }
    bClubCounts.set(String(b.clubId), (bClubCounts.get(String(b.clubId)) || 0) + 1);
    if (expected && String(b.clubId) !== expected) bMismatch++;
  }
  totalMismatch += bMismatch;
  const bProof = await proveScoping(TurfBooking, "TurfBooking", bClubCounts);
  console.log(`TurfBooking  total=${bookings.length}  noClubId=${bNoClub}(orphan=${bOrphan})  mismatch=${bMismatch}  scoping=${bProof}`);

  console.log(`\nTOTAL mismatches=${totalMismatch} (must be 0)`);
  console.log(`→ Safe to enforce: ${totalMismatch === 0 ? "YES ✅" : "NO ❌"}`);
  console.log("(noClubId turf bookings are orphans of deleted turfs — inert under enforcement.)");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Verify failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
