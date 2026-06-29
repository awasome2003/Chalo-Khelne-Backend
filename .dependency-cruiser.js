/**
 * Module-boundary rules for the Chalo Khelne backend (Phase 4 → 5b).
 *
 * Goal: a ratchet. Existing violations are BASELINED
 * (.dependency-cruiser-known-violations.json); only NEW boundary breaks fail.
 *
 *   npx depcruise src controllers routes utils middleware services factories socket cron Config
 *
 * Phase 5b: models now live in src/modules/<module>/models/, so cross-module
 * MODEL ownership is enforced by PATH (rule #2) — a module importing another
 * module's model is a cross-module violation, no longer just a rule of thumb.
 */
module.exports = {
  forbidden: [
    {
      name: "module-non-repo-imports-own-model",
      comment:
        "A module's non-repository code must go through its repository, not import its own Mongoose models directly.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/", pathNot: ["\\.repository\\.js$", "^src/modules/[^/]+/models/"] },
      to: { path: "^src/modules/$1/models/" },
    },
    {
      name: "no-cross-module-imports",
      comment:
        "Modules must not import another module's internals (incl. its models) — use its public index.js (service interface).",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.js$"],
      },
    },
    {
      name: "platform-not-into-modules",
      comment: "Cross-cutting platform code must not depend on feature modules.",
      severity: "error",
      from: { path: "^src/platform/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "legacy-controller-direct-model",
      comment:
        "TRACKED DEBT: flat controllers/routes import module models directly (no repository). Existing ones are baselined; any NEW one fails CI so the debt can't grow. Migrated per-module (Phase 3 pattern).",
      severity: "error",
      from: { path: "^(controllers|routes)/" },
      to: { path: "^src/modules/[^/]+/models/" },
    },
    {
      name: "no-modal-backup-imports",
      comment: "Modal/ has moved into modules (Phase 5b). Never import the _moved_backup orphan.",
      severity: "error",
      from: {},
      to: { path: "Modal_moved_backup/" },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make modules impossible to reason about / extract.",
      severity: "warn",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly:
      "^(src|controllers|routes|utils|middleware|services|factories|socket|cron|Config)/",
    tsPreCompilationDeps: false,
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
