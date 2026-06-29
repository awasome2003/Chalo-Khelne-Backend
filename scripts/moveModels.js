/**
 * Phase 5b — move Modal/ models into src/modules/<module>/models/ and rewrite
 * every import path. FULLY REVERSIBLE.
 *
 *   node scripts/moveModels.js --dry-run   # report the plan, change nothing
 *   node scripts/moveModels.js             # execute (copies models, rewrites
 *                                          # imports, renames Modal → _moved_backup)
 *   node scripts/moveModels.js --revert    # undo a real run from the manifest
 *
 * Design:
 *  • COPIES each model to its new home (originals preserved), rewrites all
 *    requires to the new paths, THEN renames Modal/ → Modal/_moved_backup so the
 *    originals survive as a backup and nothing imports them.
 *  • A manifest (scripts/.moveModels.manifest.json) records every edited file's
 *    BEFORE content + every created/renamed path, so --revert restores exactly.
 *  • Idempotent: a second run detects Modal/_moved_backup and refuses (already moved).
 *  • Relative requires inside MOVED files (./shared/*, ../utils/tenantScope,
 *    ../Config/*, …) are recomputed for the new depth; non-moved files only get
 *    their Modal/ requires rewritten.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODAL = path.join(ROOT, "Modal");
const MODAL_BACKUP = path.join(ROOT, "Modal", "_moved_backup"); // sentinel name only
const BACKUP_DIR = path.join(ROOT, "Modal_moved_backup");
const MANIFEST = path.join(__dirname, ".moveModels.manifest.json");

const MODE = process.argv.includes("--revert") ? "revert" : process.argv.includes("--dry-run") ? "dry" : "run";

// ── model basename (no .js) → target module ──────────────────────────
const OWN = {
  identity: ["User", "ClubManager", "Superadminmodel", "Substitute", "RefreshToken", "DeviceToken", "Role", "Permission", "CorporateClubAdmin", "OnboardingStatus", "ClubAdmin", "Player"],
  org: ["Club", "ClubSport", "Turf", "TurfBooking", "TurfReview", "ClubAdminProfile", "ClubRequest", "TrainerClubApplication", "Trainer", "Trainermodel", "TrainerBatch", "Request", "Session", "activityLog"],
  tournaments: ["Tournament", "Tournnamentmatch", "TournamentMatch", "DirectKnockoutMatch", "KnockoutMatch", "SuperMatch", "semifinal", "TeamKnockout", "TeamKnockoutMatches", "TeamKnockoutTeams", "Score", "GroupStandings", "BookingModel", "bookinggroup", "BookingGroupTop", "SuperPlayers", "TopPlayers", "CategoryTemplate", "Reminder", "Assignment", "EventModel", "TournamentParticipant", "TeamForm", "Organizermodel"],
  coaching: ["Student", "Attendance", "StudentProgress", "ProgressHistory", "ProgressSubmission", "SportsSyllabus", "SyllabusEntry", "TrainingSchedule"],
  commerce: ["Payments", "Coupon", "CouponUsage", "Expense", "ExpenseCategory", "ExpensePayment", "EquipmentListing", "Inquiry", "VendorProfile", "managerPaymentSchema", "playerPaymentSchema"],
  social: ["Post", "PostComment", "Story", "Message", "Conversation", "GroupChat", "GroupChatMessage", "ForumThread", "ForumReply", "ForumRoom", "ForumCategory", "ForumMessage", "Favorite", "PlayerNotification", "Notification", "Notification_Player", "Notification_Booking", "Invitation", "News", "ProfessionalProfile", "JobPosting", "JobApplication", "HireRequest", "StaffApplication", "Task", "PlannerNote"],
  catalog: ["Sport", "SportLibrary", "SportRuleBook", "Referee", "refreerequestModel"],
};
const moduleOf = {};
for (const m in OWN) for (const x of OWN[m]) moduleOf[x] = m;

// Subdir files: match-schema fragments → tournaments; generateToken → platform.
const SUBDIR_DEST = {
  "shared/BaseMatchFields.js": "src/modules/tournaments/models/shared/BaseMatchFields.js",
  "shared/scoringDetailFields.js": "src/modules/tournaments/models/shared/scoringDetailFields.js",
  "utils/generateToken.js": "src/platform/generateToken.js",
};

// ── build the destination map: oldModalRel ("User.js", "shared/X.js") → newAbs ──
function buildPlan() {
  const dest = {}; // oldAbs → newAbs
  const unassigned = [];
  for (const f of fs.readdirSync(MODAL)) {
    if (!f.endsWith(".js")) continue;
    const base = f.replace(/\.js$/, "");
    const mod = moduleOf[base];
    if (!mod) { unassigned.push(base); continue; }
    dest[path.join(MODAL, f)] = path.join(ROOT, "src", "modules", mod, "models", f);
  }
  for (const [rel, target] of Object.entries(SUBDIR_DEST)) {
    const abs = path.join(MODAL, rel);
    if (fs.existsSync(abs)) dest[abs] = path.join(ROOT, target);
  }
  // unassigned → src/modules/shared/models/
  for (const base of unassigned) {
    dest[path.join(MODAL, base + ".js")] = path.join(ROOT, "src", "modules", "shared", "models", base + ".js");
  }
  return { dest, unassigned };
}

// All project .js files (excluding noise + the backup).
function allJsFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "Modal_moved_backup") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) out.push(p);
    }
  })(ROOT);
  return out;
}

const REQ = /require\(\s*(["'])([^"']+)\1\s*\)/g;

// Rewrite requires in `content`. `fileOldAbs` = current path; `fileNewAbs` =
// where the file will live (same as old if not moved). `dest` = move map.
function rewrite(content, fileOldAbs, fileNewAbs, dest) {
  const oldDir = path.dirname(fileOldAbs);
  const newDir = path.dirname(fileNewAbs);
  const isMoved = fileOldAbs !== fileNewAbs;
  let changed = 0;
  const next = content.replace(REQ, (m, q, spec) => {
    if (!spec.startsWith(".")) return m; // bare module (mongoose, etc.)
    // Resolve the require target against the file's OLD directory.
    const withExt = spec.endsWith(".js") ? spec : spec + ".js";
    const targetOldAbs = path.resolve(oldDir, withExt);
    let targetNewAbs;
    if (dest[targetOldAbs]) {
      targetNewAbs = dest[targetOldAbs]; // requiring a moved model
    } else if (isMoved) {
      targetNewAbs = targetOldAbs; // moved file requiring a NON-moved target (utils/Config/etc.)
    } else {
      return m; // non-moved file requiring a non-moved target → unchanged
    }
    let rel = path.relative(newDir, targetNewAbs).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    rel = rel.replace(/\.js$/, ""); // keep extensionless style
    if (rel === spec) return m;
    changed++;
    return `require(${q}${rel}${q})`;
  });
  return { next, changed };
}

function run() {
  if (fs.existsSync(BACKUP_DIR)) {
    console.log("Modal_moved_backup already exists — models already moved. Aborting (idempotent).");
    process.exit(0);
  }
  const { dest, unassigned } = buildPlan();
  const files = allJsFiles();

  // ── dry-run report ──
  if (MODE === "dry") {
    const byModule = {};
    for (const [oldAbs, newAbs] of Object.entries(dest)) {
      const mod = path.relative(path.join(ROOT, "src", "modules"), newAbs).split(path.sep)[0] || "platform";
      (byModule[mod] = byModule[mod] || []).push(path.basename(oldAbs));
    }
    console.log("── MOVE PLAN (dry-run) ──\n");
    for (const mod of Object.keys(byModule).sort()) {
      console.log(`${mod}/models/  (${byModule[mod].length}): ${byModule[mod].sort().join(", ")}`);
    }
    console.log(`\nTotal model files to move: ${Object.keys(dest).length}`);
    console.log(`Unassigned → shared/models/: ${unassigned.length ? unassigned.join(", ") : "(none)"}`);

    let filesTouched = 0, importsChanged = 0;
    for (const f of files) {
      const newAbs = dest[f] || f;
      const { changed } = rewrite(fs.readFileSync(f, "utf8"), f, newAbs, dest);
      if (changed > 0) { filesTouched++; importsChanged += changed; }
    }
    console.log(`Files needing import rewrites: ${filesTouched}`);
    console.log(`Total require() statements to update: ${importsChanged}`);
    console.log("\n(no changes written — dry run)");
    return;
  }

  // ── real run ──
  const manifest = { edits: [], created: [], backupDir: path.basename(BACKUP_DIR) };
  let filesTouched = 0, importsChanged = 0;

  // 1) rewrite imports in every NON-moved file (moved models are rewritten in
  //    the copy pass below). Record before-content for revert.
  for (const f of files) {
    if (dest[f]) continue; // a model being moved — handled in step 2
    const before = fs.readFileSync(f, "utf8");
    const { next, changed } = rewrite(before, f, f, dest);
    if (changed > 0) {
      manifest.edits.push({ path: f, before });
      fs.writeFileSync(f, next);
      filesTouched++; importsChanged += changed;
    }
  }

  // 2) copy model files to their new homes (rewriting their own requires)
  for (const [oldAbs, newAbs] of Object.entries(dest)) {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    const before = fs.readFileSync(oldAbs, "utf8");
    const { next } = rewrite(before, oldAbs, newAbs, dest);
    fs.writeFileSync(newAbs, next);
    manifest.created.push(newAbs);
  }

  // 3) rename Modal → Modal_moved_backup (originals preserved, nothing imports them)
  fs.renameSync(MODAL, BACKUP_DIR);
  manifest.modalRenamedTo = BACKUP_DIR;

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log("── MOVE COMPLETE ──");
  console.log(`Model files moved: ${Object.keys(dest).length}`);
  console.log(`Files with imports updated: ${filesTouched}`);
  console.log(`require() statements rewritten: ${importsChanged}`);
  console.log(`Originals preserved at: ${path.basename(BACKUP_DIR)}`);
  console.log(`Manifest: ${path.relative(ROOT, MANIFEST)} (run --revert to undo)`);
}

function revert() {
  if (!fs.existsSync(MANIFEST)) { console.error("No manifest — nothing to revert."); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (m.modalRenamedTo && fs.existsSync(m.modalRenamedTo)) fs.renameSync(m.modalRenamedTo, MODAL);
  for (const c of m.created) { try { fs.unlinkSync(c); } catch (_) {} }
  for (const e of m.edits) fs.writeFileSync(e.path, e.before);
  // best-effort: prune empty models/ dirs we created
  fs.unlinkSync(MANIFEST);
  console.log(`Reverted: restored Modal/, undid ${m.edits.length} file edits, removed ${m.created.length} copies.`);
}

if (MODE === "revert") revert();
else run();
