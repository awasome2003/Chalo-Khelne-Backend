// server/scripts/auditLegacyTypeField.js
//
// STEP 17a.5 — focused audit of `Tournament.type` references.
//
// `type` is a JS keyword and ambiguous: most occurrences are NOT
// Tournament.type — they're match.type, paymentType, Schema.Types,
// JSX `type="..."` props, etc. This script applies strict patterns
// and excludes known-noise contexts so the output is reviewable.
//
// Classifications:
//   PROP_STRONG  — direct property access on a clearly-tournament alias
//                  (tournament, tournamentExists, _tournament, etc.)
//   PROP_WEAK    — `t.type` or `tour.type` — could be tournament,
//                  could be a generic loop variable. Manual review.
//   REQ          — req.body.type. In tournamentController.js this is
//                  almost always Tournament.type; elsewhere it might
//                  be a different type field.
//   WRITE        — explicit assignment: `tournament.type =`,
//                  `tournamentData.type =`, etc.
//
// Excluded:
//   - .backup files, node_modules, dist, build
//   - Lines containing one of the EXCLUDE_TOKENS strings — these
//     are well-known false-positive contexts.
//
// Usage:
//   node server/scripts/auditLegacyTypeField.js
//   node server/scripts/auditLegacyTypeField.js --json

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

// Files where references are intentional / not in scope.
const KNOWN_LEGACY_FILES = [
  path.join("server", "scripts", "migrateToMultiSport.js"),
  path.join("server", "scripts", "verifyBookingMigration.js"),
  path.join("server", "scripts", "auditMultiSportRequiredness.js"),
  path.join("server", "scripts", "auditLegacyFieldUsage.js"),
  path.join("server", "scripts", "auditLegacyTypeField.js"),
  path.join("server", "scripts", "spotcheckTournamentSports.js"),
  path.join("server", "utils", "sportTrackUtils.js"),
  ".backup.jsx",
  ".backup.js",
];
const SCHEMA_FILES = [
  path.join("server", "Modal", "Tournament.js"),
];

// Tokens whose presence on the same line strongly suggests this is
// NOT Tournament.type. Skip such lines.
const EXCLUDE_TOKENS = [
  "Schema.Types",       // mongoose type refs
  "mongoose.Types",
  "Types.ObjectId",
  "match.type",         // group stage / knockout match category
  "matchType",
  "tournamentType",     // separate field on Booking/match; means "knockout"/"group stage" string
  "paymentType",
  "userType",
  "playerType",
  "roundType",
  "scoringType",
  "eventType",
  "notificationType",
  "roleType",
  "fileType",
  "contentType",
  "MIME",
  "TypeError",
  "typeof",
  "instanceof",
  "type=\"",            // JSX attribute
  "type='",
  "react-native",       // RN prop noise
  "import type",        // TS type imports
];

const STRONG_ALIASES = [
  "tournament",
  "tournamentExists",
  "_tournament",
  "_tournamentForSport",
  "tournamentDoc",
  "tournamentData",
];
const WEAK_ALIASES = ["t", "tour"];

const ALL_STRONG_RE = new RegExp(
  `\\b(?:${STRONG_ALIASES.join("|")})\\.type\\b(?!\\w)`
);
const ALL_WEAK_RE = new RegExp(
  `\\b(?:${WEAK_ALIASES.join("|")})\\.type\\b(?!\\w)`
);
const REQ_RE = /\breq\.body\.type\b(?!\w)/;
const WRITE_RE = new RegExp(
  `\\b(?:${STRONG_ALIASES.join("|")})\\.type\\s*=`
);

const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");

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

function lineHasExcludeToken(line) {
  for (const t of EXCLUDE_TOKENS) {
    if (line.includes(t)) return true;
  }
  return false;
}

function classifyMatch(line) {
  if (WRITE_RE.test(line)) return "WRITE";
  if (ALL_STRONG_RE.test(line)) return "PROP_STRONG";
  if (REQ_RE.test(line)) return "REQ";
  if (ALL_WEAK_RE.test(line)) return "PROP_WEAK";
  return null;
}

function scan() {
  const hits = [];

  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const classification = classifyFile(file);
      const rel = relPath(file);
      let lines;
      try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); }
      catch { continue; }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Reject lines containing a clearer signal that this isn't Tournament.type.
        if (lineHasExcludeToken(line)) continue;
        const kind = classifyMatch(line);
        if (!kind) continue;
        hits.push({
          file: rel,
          line: i + 1,
          snippet: line.trim().slice(0, 180),
          kind,
          classification,
        });
      }
    }
  }

  return hits;
}

function summarize(hits) {
  const summary = {
    total: hits.length,
    byClassification: {},
    byKind: {},
  };
  for (const h of hits) {
    summary.byClassification[h.classification] =
      (summary.byClassification[h.classification] || 0) + 1;
    summary.byKind[h.kind] = (summary.byKind[h.kind] || 0) + 1;
  }
  return summary;
}

function printConsole(hits, summary) {
  console.log("\n[AUDIT-17a.5] STEP 17a.5 — focused Tournament.type audit");
  console.log(`[AUDIT-17a.5] Total hits: ${summary.total}`);
  console.log(`[AUDIT-17a.5] By classification:`, summary.byClassification);
  console.log(`[AUDIT-17a.5] By kind:`, summary.byKind);
  console.log(
    `[AUDIT-17a.5] Excluded ${EXCLUDE_TOKENS.length} known-noise tokens; PROP_WEAK requires manual review.`
  );

  // Group by classification, then by file.
  const groups = { code: [], schema: [], "known-legacy": [] };
  for (const h of hits) groups[h.classification].push(h);

  for (const cls of ["code", "schema", "known-legacy"]) {
    const arr = groups[cls];
    if (arr.length === 0) continue;
    console.log(`\n[AUDIT-17a.5] ${cls.toUpperCase()} (${arr.length} hits):`);
    const byFile = {};
    for (const h of arr) {
      if (!byFile[h.file]) byFile[h.file] = [];
      byFile[h.file].push(h);
    }
    for (const [file, fileHits] of Object.entries(byFile)) {
      console.log(`\n  ${file} (${fileHits.length}):`);
      for (const h of fileHits) {
        console.log(`    [${h.kind}] :${h.line}  ${h.snippet}`);
      }
    }
  }
}

function main() {
  const hits = scan();
  const summary = summarize(hits);

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, hits }, null, 2));
  } else {
    printConsole(hits, summary);
  }

  const logPath = path.join(__dirname, "audit-legacy-type-field.log");
  fs.writeFileSync(logPath, JSON.stringify({ summary, hits }, null, 2));
  if (!JSON_OUT) console.log(`\n[AUDIT-17a.5] Log written to ${logPath}`);
}

main();
