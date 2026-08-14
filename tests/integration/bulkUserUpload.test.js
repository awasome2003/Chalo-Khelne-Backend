"use strict";
/**
 * Bulk user provisioning — /api/bulk-upload.
 *
 * The router has always been guarded by requireSuperAdmin, but its only UI
 * lived inside the old SuperAdmin Sidebar component. That component was
 * orphaned when the shared shell replaced it, so the feature was unreachable
 * from the running app until it was restored as its own page.
 *
 * These assertions pin the two things that matter about the endpoint:
 *
 *   1. It stays SuperAdmin-only, and — unlike most routes here — a bare
 *      "role: superadmin" JWT claim is NOT enough. requireSuperAdmin resolves
 *      the id against the Superadmin collection, so a forged claim fails.
 *   2. An imported row can never provision its own role, approval state or
 *      permissions. Every account lands as an approved Player regardless of
 *      what the spreadsheet says.
 *
 * The per-row report is asserted too, because the page renders it: an operator
 * needs to know WHICH rows were rejected, not just how many.
 */

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const {
  startTestApp,
  stopTestApp,
  clearDatabase,
} = require("./setup");

const User = require("../../src/modules/identity/models/User");
const Superadminmodel = require("../../src/modules/identity/models/Superadminmodel");

let app;
let token;

// requireSuperAdmin does a membership check against the Superadmin collection,
// so the token must carry the id of a row that actually exists.
async function seedSuperAdmin() {
  const sa = await Superadminmodel.create({
    email: "qa-sa@test.local",
    password: "irrelevant-but-required",
  });
  return jwt.sign({ email: sa.email, userId: sa._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

// dateOfBirth is a required column: every imported account is a Player, and
// User.dateOfBirth is mandatory for the age-gated roles.
const csv = (rows) =>
  Buffer.from(
    ["name,email,mobile,password,dateOfBirth", ...rows].join("\n"),
    "utf8"
  );

const ROW_A = "Asha Rao,asha@test.local,9000000001,pw123456,1998-04-23";
const ROW_B = "Bilal Khan,bilal@test.local,9000000002,pw123456,2001-11-02";

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await stopTestApp();
});
beforeEach(async () => {
  await clearDatabase();
  token = await seedSuperAdmin();
});

describe("authorization", () => {
  it("refuses an anonymous import", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .attach("file", csv([ROW_A]), "users.csv");
    expect(res.status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it("refuses a forged superadmin claim that is not in the Superadmin collection", async () => {
    // This token looks exactly like a real one and would pass any gate that
    // trusts the role string. requireSuperAdmin resolves the id instead.
    const forged = jwt.sign(
      { email: "attacker@test.local", role: "superadmin", userId: new mongoose.Types.ObjectId() },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${forged}`)
      .attach("file", csv([ROW_A]), "users.csv");
    expect(res.status).toBe(403);
    expect(await User.countDocuments()).toBe(0);
  });

  it("serves the template only to a real superadmin", async () => {
    await request(app).get("/api/bulk-upload/template").expect(401);

    const ok = await request(app)
      .get("/api/bulk-upload/template")
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toContain("ChaloKhelne_User_Template.xlsx");
  });
});

describe("import", () => {
  it("creates users and reports the counts", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        csv([ROW_A, ROW_B]),
        "users.csv"
      );

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.rows).toEqual([]);
    expect(await User.countDocuments()).toBe(2);
  });

  it("never provisions role, approval or permissions from the file", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        Buffer.from(
          [
            "name,email,mobile,password,dateOfBirth,role,isApproved",
            "Mallory,mallory@test.local,9000000009,pw123456,1995-06-15,SuperAdmin,true",
          ].join("\n"),
          "utf8"
        ),
        "users.csv"
      );

    expect(res.body.created).toBe(1);
    const created = await User.findOne({ email: "mallory@test.local" }).lean();
    expect(created.role).toBe("Player");
  });

  it("reports a duplicate as skipped, not failed, so a re-run reads as a no-op", async () => {
    const file = () => csv([ROW_A]);

    const first = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", file(), "users.csv");
    expect(first.body.created).toBe(1);

    const second = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", file(), "users.csv");

    expect(second.body.created).toBe(0);
    expect(second.body.skipped).toBe(1);
    expect(second.body.failed).toBe(0);
    expect(second.body.rows[0]).toMatchObject({
      status: "skipped",
      email: "asha@test.local",
    });
    expect(await User.countDocuments()).toBe(1);
  });

  it("names the missing column on an incomplete row, and keeps the good ones", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        csv([
          ROW_A,
          "Nomobile Person,nomobile@test.local,,pw123456,1999-01-01",
        ]),
        "users.csv"
      );

    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(1);

    const failed = res.body.rows.find((r) => r.status === "failed");
    expect(failed.reason).toMatch(/mobile/i);
    // Row numbers are 1-based and count the header, so they line up with Excel.
    expect(failed.row).toBe(3);
  });

  // Regression: dateOfBirth is required for Player, the importer never asked
  // for it, and miniAIMapper had no synonym for it — so EVERY row failed schema
  // validation and the whole feature was inert.
  it("reads a DOB column and derives age from it", async () => {
    await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", csv([ROW_A]), "users.csv")
      .expect(200);

    const created = await User.findOne({ email: "asha@test.local" }).lean();
    expect(created.dateOfBirth).toBeInstanceOf(Date);
    expect(created.dateOfBirth.toISOString()).toContain("1998-04-23");
    // The User pre-save hook derives these from dateOfBirth.
    expect(typeof created.age).toBe("number");
    expect(created.isMinor).toBe(false);
  });

  it.each([
    ["DOB", "Dob Header,dobheader@test.local,9000000021,pw123456,1998-04-23"],
    ["Date of Birth", "Long Header,longheader@test.local,9000000022,pw123456,1998-04-23"],
  ])("resolves a %s column heading", async (heading, row) => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        Buffer.from(
          [`name,email,mobile,password,${heading}`, row].join("\n"),
          "utf8"
        ),
        "users.csv"
      );
    expect(res.body.created).toBe(1);
  });

  it("reports a missing or unreadable DOB instead of failing opaquely", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        csv([
          "No Dob,nodob@test.local,9000000031,pw123456,",
          "Bad Dob,baddob@test.local,9000000032,pw123456,not-a-date",
        ]),
        "users.csv"
      );

    expect(res.body.created).toBe(0);
    expect(res.body.failed).toBe(2);
    expect(res.body.rows[0].reason).toMatch(/dateOfBirth/i);
    expect(res.body.rows[1].reason).toMatch(/date of birth/i);
    expect(await User.countDocuments()).toBe(0);
  });

  it("accepts DD/MM/YYYY as well as ISO", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "file",
        csv(["Dmy Person,dmy@test.local,9000000041,pw123456,23/04/1998"]),
        "users.csv"
      );

    expect(res.body.created).toBe(1);
    const created = await User.findOne({ email: "dmy@test.local" }).lean();
    expect(created.dateOfBirth.getFullYear()).toBe(1998);
    expect(created.dateOfBirth.getMonth()).toBe(3); // April, 0-indexed
  });

  it("rejects an unsupported file type without creating anything", async () => {
    const res = await request(app)
      .post("/api/bulk-upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not a spreadsheet", "utf8"), "notes.txt");

    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });
});

describe("single user", () => {
  it("creates one, and refuses a duplicate email", async () => {
    const body = {
      name: "Solo",
      email: "solo@test.local",
      mobile: "9000000003",
      password: "pw123456",
      dateOfBirth: "1997-03-08",
    };

    await request(app)
      .post("/api/bulk-upload/single")
      .set("Authorization", `Bearer ${token}`)
      .send(body)
      .expect(200);

    const dup = await request(app)
      .post("/api/bulk-upload/single")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(dup.status).toBe(400);
    expect(await User.countDocuments()).toBe(1);
  });

  it("forces the Player role even when the body asks for more", async () => {
    await request(app)
      .post("/api/bulk-upload/single")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Climber",
        email: "climber@test.local",
        mobile: "9000000004",
        password: "pw123456",
        dateOfBirth: "1996-09-12",
        role: "SuperAdmin",
        isApproved: true,
      })
      .expect(200);

    const created = await User.findOne({ email: "climber@test.local" }).lean();
    expect(created.role).toBe("Player");
  });

  it("returns a specific 400 for a missing DOB rather than an opaque 500", async () => {
    const res = await request(app)
      .post("/api/bulk-upload/single")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "No Dob",
        email: "singlenodob@test.local",
        mobile: "9000000005",
        password: "pw123456",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date of birth/i);
    expect(await User.countDocuments()).toBe(0);
  });
});
