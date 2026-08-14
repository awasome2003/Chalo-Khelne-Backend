/**
 * DOB / Families-Policy QA check.  Run:  node _dobQaCheck.js
 *
 * Exercises the DOB enforcement added 2026-08-05:
 *   A. /register rejects missing / invalid / under-13 DOB, accepts valid.
 *   B. requireDob middleware blocks unknown-age accounts when the gate is ON.
 *
 * Needs the dev server running on PORT (default 3003). Creates users under
 * __dobqa_*@example.invalid and deletes them again at the end.
 */
require("dotenv").config();

const PORT = process.env.PORT || 3003;
const B = `http://localhost:${PORT}/api`;
const STAMP = Date.now();
const EMAIL = `__dobqa_${STAMP}@example.invalid`;

let pass = 0;
let fail = 0;

const post = async (path, body) => {
  const r = await fetch(B + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let j = {};
  try {
    j = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, body: j };
};

const row = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(44)} got=${got}  want=${want}`);
};

(async () => {
  console.log("\n── A. /register DOB enforcement (live server) ──");
  let r;

  r = await post("/register", { name: "A", email: `a${EMAIL}`, mobile: "9000000001", password: "Test@1234", role: "Player" });
  row("no DOB", r.body.code || r.status, "DOB_REQUIRED");

  r = await post("/register", { name: "B", email: `b${EMAIL}`, mobile: "9000000002", password: "Test@1234", role: "Player", dateOfBirth: "not-a-date" });
  row("unparseable DOB", r.body.code || r.status, "DOB_INVALID");

  r = await post("/register", { name: "C", email: `c${EMAIL}`, mobile: "9000000003", password: "Test@1234", role: "Player", dateOfBirth: "2018-01-01" });
  row("under-13", r.body.code || r.status, "UNDER_13_SELF_SIGNUP");

  r = await post("/register", { name: "D", email: EMAIL, mobile: "9000000004", password: "Test@1234", role: "Player", dateOfBirth: "2000-01-01" });
  row("valid DOB accepted", r.status === 200 || r.status === 201 ? "created" : `${r.status}:${r.body.code || r.body.message}`, "created");

  r = await post("/register", { name: "E", email: `e${EMAIL}`, mobile: "9000000005", password: "Test@1234", role: "ClubAdmin" });
  row("ClubAdmin without DOB allowed", r.status === 200 || r.status === 201 ? "created" : `${r.body.code || r.status}`, "created");

  console.log("\n── B. requireDob middleware (both flag states) ──");
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("../../src/modules/identity/models/User");
  const { requireDob } = require("../../middleware/requireDob");

  const player = await User.findOne({ email: EMAIL });
  const admin = await User.findOne({ email: `e${EMAIL}` });

  if (!player) {
    console.log("  SKIP  test player was not created — cannot exercise the gate");
  } else {
    // Simulate an unknown-age account (the state 558 live accounts are in).
    await User.updateOne({ _id: player._id }, { $unset: { dateOfBirth: "" }, $set: { dobRequired: true } });

    const run = async (flag, userId) => {
      process.env.ENFORCE_DOB_GATE = flag;
      let outcome = "next()";
      const res = {
        status(c) { this._c = c; return this; },
        json(b) { outcome = `${this._c}:${b.code}`; return this; },
      };
      await requireDob({ user: { id: userId } }, res, () => { outcome = "next()"; });
      return outcome;
    };

    row("gate OFF, unknown age", await run("false", player._id), "next()");
    row("gate ON,  unknown age", await run("true", player._id), "403:DOB_REQUIRED");

    await User.updateOne({ _id: player._id }, { $set: { dateOfBirth: new Date(2000, 0, 1), dobRequired: false } });
    row("gate ON,  DOB present", await run("true", player._id), "next()");

    if (admin) row("gate ON,  ClubAdmin (exempt role)", await run("true", admin._id), "next()");
  }

  const del = await User.deleteMany({ email: { $regex: "^(a|b|c|d|e)?__dobqa_.*@example\\.invalid$" } });
  console.log(`\n── cleanup: removed ${del.deletedCount} test user(s) ──`);
  await mongoose.disconnect();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
