// ESLint 9 flat config. Deliberately PERMISSIVE for now — the goal in Phase 0
// is to catch genuine bugs (undefined vars, duplicate object keys, unreachable
// code) across 71k LOC of legacy code WITHOUT producing thousands of style
// warnings that would make CI useless. Tighten rule-by-rule in later phases.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "uploads/**",
      "coverage/**",
      "public/**",
      "docs/**",
      "Modal_moved_backup/**", // Phase 5b orphan backup — not part of the live tree
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      // Real-bug rules — keep ON.
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],

      // Noise on a large legacy base — downgrade so they inform, not block.
      "no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-undef": "error",
    },
  },
  {
    // Test files get the jest globals.
    files: ["tests/**/*.js", "__tests__/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    // ── Module boundary (Phase 4) ──────────────────────────────────────
    // Inside src/modules/, only *.repository.js may import Mongoose models.
    // Everything else (service/controller/index) must go through the repo.
    // CommonJS require() isn't covered by no-restricted-imports, so we match
    // the require() call AST directly.
    files: ["src/modules/**/*.js"],
    ignores: ["src/modules/**/*.repository.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/Modal\\//]",
          message:
            "Module boundary: non-repository code must not import models directly — go through the module's repository (Phase 4).",
        },
      ],
    },
  },
];
