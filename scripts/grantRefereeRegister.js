/**
 * Grant `tournament:register` to the referee role.
 *
 * Referees could not enter a tournament as a competitor: the booking endpoint
 * is gated by requirePermission("tournament:register") and the referee role
 * never carried it, so every attempt returned a bare 403 "Access denied".
 * Trainer — the other non-Player participant role — has always had it.
 *
 * WHY NOT JUST RE-RUN seedRbac: that handler rewrites `permissions` for EVERY
 * role from its own definition, so re-seeding would discard any permission
 * edits made through the SuperAdmin panel. This touches one role and adds one
 * permission.
 *
 * Idempotent — safe to run more than once.
 *
 *   node scripts/grantRefereeRegister.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");

// Windows configures placeholder IPv6 DNS servers (fec0:0:0:ffff::1/2/3) that
// nothing answers on. Windows itself skips them, but Node's resolver tries
// them first and fails the SRV lookup a mongodb+srv:// URI needs, with
// "querySrv ECONNREFUSED". Fall back to public resolvers only when the
// system's own lookup fails, so a machine with working DNS is left alone.
const FALLBACK_DNS = ["1.1.1.1", "8.8.8.8"];

async function connectWithDnsFallback(uri) {
  const opts = { serverSelectionTimeoutMS: 20000 };
  try {
    return await mongoose.connect(uri, opts);
  } catch (err) {
    const dnsFailure = /querySrv|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(err.message || "");
    if (!dnsFailure) throw err;
    console.warn(`DNS lookup failed (${err.message}) — retrying via ${FALLBACK_DNS.join(", ")}`);
    dns.setServers(FALLBACK_DNS);
    return await mongoose.connect(uri, opts);
  }
}

const PERMISSION_KEY = "tournament:register";
const ROLE_SLUG = "referee";

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Run this from the server directory.");
    process.exit(1);
  }

  await connectWithDnsFallback(uri);
  console.log(`connected to database: ${mongoose.connection.name}`);

  const Role = require("../src/modules/identity/models/Role");
  const Permission = require("../src/modules/identity/models/Permission");

  const permission = await Permission.findOne({ key: PERMISSION_KEY });
  if (!permission) {
    console.error(
      `Permission "${PERMISSION_KEY}" does not exist. Seed RBAC first ` +
        `(POST /api/rbac/seed), then re-run this.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const role = await Role.findOne({ slug: ROLE_SLUG });
  if (!role) {
    console.error(`Role "${ROLE_SLUG}" does not exist. Nothing to update.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const already = (role.permissions || []).some(
    (id) => String(id) === String(permission._id)
  );

  if (already) {
    console.log(`No change — "${ROLE_SLUG}" already has "${PERMISSION_KEY}".`);
  } else {
    role.permissions.push(permission._id);
    await role.save();
    console.log(`Granted "${PERMISSION_KEY}" to "${ROLE_SLUG}".`);
  }

  const updated = await Role.findOne({ slug: ROLE_SLUG }).populate("permissions");
  console.log(
    `"${ROLE_SLUG}" now grants: ${updated.permissions.map((p) => p.key).sort().join(", ")}`
  );

  await mongoose.disconnect();
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
