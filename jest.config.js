// Jest is scoped to tests/integration ONLY. The existing __tests__/tenancy.test.js
// uses the Node built-in test runner (node --test) and must NOT be picked up by
// Jest — it's run via `npm run test:tenancy`. Keeping the two runners separate
// avoids a rewrite of the working tenancy suite.
module.exports = {
  testEnvironment: "node",
  // Both integration (real in-memory Mongo) and unit (mocked repo, no DB) suites.
  // The legacy __tests__/tenancy.test.js (node:test runner) is NOT under tests/.
  testMatch: [
    '**/tests/integration/**/*.test.js',
    '**/tests/unit/**/*.test.js'
  ],
  // One in-memory MongoDB per file, started in each suite's beforeAll. Run
  // serially so suites don't race on the shared mongoose default connection.
  maxWorkers: 1,
  testTimeout: 60000, // first run downloads the mongod binary
  // Don't let an unfinished socket/handle hang the run after tests pass.
  forceExit: true,
};
