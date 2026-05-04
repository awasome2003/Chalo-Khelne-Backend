// server/scripts/auditLegacyFieldUsage.js
//
// STEP 17a — read-only audit. Scans the codebase for references to
// deprecated fields scheduled for removal in STEP 17. Catches both
// reads (which break silently after 17e schema removal if missed)
// and writes (which become no-ops after 17e and dead data after 17g).
//
// Field surface scanned:
//   Tournament root scalars: sportsType, matchFormat, sportRules,
//     category, qualifyPerGroup, drawSize, currentStage, stageConfig,
//     groupStageFormat, knockoutFormat, davisCupFormatId
//     (Note: `type` is excluded — too noisy as a generic keyword;
//     manual review required for that one.)
//   Booking: selectedCategories
//
// Output: per-field (file, line, snippet) groupings + a summary count.
// Some files are flagged as "known-legacy" (migration / audit /
// backup files) — these references are intentional and will be
// addressed at code-removal time, not field-rename time.
//
// Usage:
//   node server/scripts/auditLegacyFieldUsage.js
//   node server/scripts/auditLegacyFieldUsage.js --field sportsType   (filter to one field)
//   node server/scripts/auditLegacyFieldUsage.js --json               (machine-readable output)

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SCAN_DIRS = [
  path.join(ROOT, "server"),
  path.join(ROOT, "sports_app", "src"),
  path.join(ROOT, "client", "src"),
];
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", "uploads", ".next", "coverage",
]);
const ALLOWED_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);

// Files we expect to reference legacy fields by design — they're either
// migration scripts (read legacy → write new) or audit scripts (count
// legacy presence). Listed by suffix-match against the absolute path.
const KNOWN_LEGACY_FILES = [
  path.join("server", "scripts", "migrateToMultiSport.js"),
  path.join("server", "scripts", "verifyBookingMigration.js"),
  path.join("server", "scripts", "auditMultiSportRequiredness.js"),
  path.join("server", "scripts", "auditLegacyFieldUsage.js"),
  path.join("server", "scripts", "spotcheckTournamentSports.js"),
  path.join("server", "scripts", "seedAllSportsTournaments.js"),
  path.join("server", "scripts", "seedChessTournament.js"),
  path.join("server", "utils", "sportTrackUtils.js"), // synthesizeLegacyTrack lives here; deleted in 17d
  ".backup.jsx",
  ".backup.js",
];

// Schema files DEFINE the legacy fields. References here are the
// removal targets in 17e — flagged separately so they don't drown
// the read/write report.
const SCHEMA_FILES = [
  path.join("server", "Modal", "Tournament.js"),
  path.join("server", "Modal", "BookingModel.js"),
];

const TOURNAMENT_ROOT_FIELDS = [
  "sportsType",
  "matchFormat",
  "sportRules",
  "category",
  "qualifyPerGroup",
  "drawSize",
  "currentStage",
  "stageConfig",
  "groupStageFormat",
  "knockoutFormat",
  "davisCupFormatId",
];

// `type` is excluded from the auto-scan — it's a JS keyword and
// virtually every file uses it. Manual review required.
const MANUAL_REVIEW_FIELDS = ["type"];

const BOOKING_FIELDS = ["selectedCategories"];

const ARGS = process.argv.slice(2);
const FILTER_FIELD = (() => {
  const i = ARGS.indexOf("--field");
  return i >= 0 ? ARGS[i + 1] : null;
})();
const JSON_OUT = ARGS.includes("--json");

// Build per-field regex set.
// Patterns:
//   [A] property access: `<obj>.<field>` where <obj> is one of a few
//       likely tournament/booking aliases. Catches reads.
//   [B] req.body.<field>: catches incoming writes.
//   [C] destructure-from-tournament: `{ ..., <field>, ... } = ...tournament|t|tour|booking|b...`
//       — too brittle to regex reliably; we settle for [A] + [B] and
//       trust manual review on edge cases.
//   [D] object-literal write: bare `<field>:` in a non-schema file.
//       Noisy; we include but mark with [LIT].
function buildFieldPatterns(field) {
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    // STEP 17c — added `b` to Booking aliases. The 17a sweep missed
    // `b.selectedCategories` reads inside iteration callbacks (caught
    // pre-17c grep, fixed in clubAdminFinanceController).
    PROP: new RegExp(`\\b(?:tournament|tour|t|tournamentExists|_tournament|_tournamentForSport|tournamentDoc|tournamentData|booking|b|existingBooking|bookingDetails|bookingData|reg)\\.${f}\\b`),
    REQ:  new RegExp(`\\breq\\.body\\.${f}\\b`),
    LIT:  new RegExp(`(^|[\\s,({\\[])${f}\\s*:`),
  };
}

function isSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (isSkipDir(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      if (ALLOWED_EXT.has(path.extname(e.name))) {
        yield path.join(dir, e.name);
      }
    }
  }
}

function classifyFile(absPath) {
  for (const suffix of KNOWN_LEGACY_FILES) {
    if (absPath.endsWith(suffix)) return "known-legacy";
  }
  for (const suffix of SCHEMA_FILES) {
    if (absPath.endsWith(suffix)) return "schema";
  }
  return "code";
}

function relPath(p) {
  return path.relative(ROOT, p);
}

function scan() {
  const results = {}; // field → array of {file, line, snippet, kind, classification}
  const allFields = [...TOURNAMENT_ROOT_FIELDS, ...BOOKING_FIELDS]
    .filter((f) => !FILTER_FIELD || f === FILTER_FIELD);

  for (const f of allFields) results[f] = [];

  const patternByField = new Map();
  for (const f of allFields) patternByField.set(f, buildFieldPatterns(f));

  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const classification = classifyFile(file);
      const rel = relPath(file);
      let lines;
      try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); }
      catch { continue; }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const f of allFields) {
          const pat = patternByField.get(f);
          let kind = null;
          if (pat.PROP.test(line)) kind = "PROP";
          else if (pat.REQ.test(line)) kind = "REQ";
          else if (pat.LIT.test(line)) kind = "LIT";
          if (kind) {
            results[f].push({
              file: rel,
              line: i + 1,
              snippet: line.trim().slice(0, 160),
              kind,
              classification,
            });
          }
        }
      }
    }
  }

  return results;
}

function summarize(results) {
  const summary = {};
  for (const [field, hits] of Object.entries(results)) {
    summary[field] = {
      totalHits: hits.length,
      byClassification: hits.reduce((acc, h) => {
        acc[h.classification] = (acc[h.classification] || 0) + 1;
        return acc;
      }, {}),
      byKind: hits.reduce((acc, h) => {
        acc[h.kind] = (acc[h.kind] || 0) + 1;
        return acc;
      }, {}),
    };
  }
  return summary;
}

function printConsole(results, summary) {
  const fields = Object.keys(results);
  console.log("\n[AUDIT-17a] STEP 17a — legacy field usage audit");
  console.log(`[AUDIT-17a] Fields scanned: ${fields.length}`);
  console.log(`[AUDIT-17a] Manual review required (excluded): ${MANUAL_REVIEW_FIELDS.join(", ")}`);
  console.log(`[AUDIT-17a] Classifications: code = needs migration; schema = removal target; known-legacy = intentional`);
  console.log(`[AUDIT-17a] Kinds: PROP = obj.field access; REQ = req.body.field; LIT = bare object-literal key (noisy)`);

  console.log("\n[AUDIT-17a] Summary:");
  for (const f of fields) {
    const s = summary[f];
    const code = s.byClassification.code || 0;
    const schema = s.byClassification.schema || 0;
    const known = s.byClassification["known-legacy"] || 0;
    console.log(
      `  ${f.padEnd(22)} total=${String(s.totalHits).padStart(4)}  code=${String(code).padStart(3)}  schema=${schema}  known-legacy=${known}`
    );
  }

  console.log("\n[AUDIT-17a] Detail (code references only — schema + known-legacy omitted):");
  for (const f of fields) {
    const codeHits = results[f].filter((h) => h.classification === "code");
    if (codeHits.length === 0) continue;
    console.log(`\n  --- ${f} (${codeHits.length} code refs) ---`);
    for (const h of codeHits) {
      console.log(`  [${h.kind}] ${h.file}:${h.line}`);
      console.log(`        ${h.snippet}`);
    }
  }
}

function main() {
  const results = scan();
  const summary = summarize(results);

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    printConsole(results, summary);
  }

  // Always write the JSON log alongside, regardless of console mode.
  const logPath = path.join(__dirname, "audit-legacy-field-usage.log");
  fs.writeFileSync(logPath, JSON.stringify({ summary, results }, null, 2));
  if (!JSON_OUT) console.log(`\n[AUDIT-17a] Log written to ${logPath}`);
}

main();
