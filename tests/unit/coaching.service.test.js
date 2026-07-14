"use strict";
/**
 * Phase 3 — coaching SERVICE unit tests.
 *
 * Pure unit tests: the repository is mocked, so NO database is involved. These
 * test business rules in isolation (validation, ordering, upsert-idempotency,
 * not-found handling).
 */
jest.mock("../../src/modules/coaching/coaching.repository");

const repo = require("../../src/modules/coaching/coaching.repository");
const service = require("../../src/modules/coaching/coaching.service");

beforeEach(() => {
  jest.clearAllMocks();
  // Default: transactions just run their work callback (no real session).
  repo.runInTransaction.mockImplementation((work) => work("session"));
});

describe("createStudent", () => {
  test("happy path — trims input, computes order, delegates to repo", async () => {
    repo.countStudents.mockResolvedValue(2);
    repo.createStudent.mockImplementation((doc) => Promise.resolve({ _id: "s1", ...doc }));

    const student = await service.createStudent("club1", { name: "  Aarav  ", standard: " V " });

    expect(repo.countStudents).toHaveBeenCalledWith("club1", "V");
    expect(repo.createStudent).toHaveBeenCalledWith({
      clubId: "club1", standard: "V", name: "Aarav", rollNo: "", section: "", order: 2,
    });
    expect(student.name).toBe("Aarav");
  });

  test("validation failure — missing name → 400, repo never called", async () => {
    await expect(service.createStudent("club1", { name: "", standard: "V" }))
      .rejects.toMatchObject({ name: "ServiceError", status: 400 });
    expect(repo.createStudent).not.toHaveBeenCalled();
  });
});

describe("markAttendance", () => {
  const eff = { trainerId: "t1", clubId: "club1" };

  test("happy path — writes upsert ops inside a transaction", async () => {
    repo.bulkUpsertAttendance.mockResolvedValue({ ok: 1 });

    const result = await service.markAttendance(eff, {
      date: "2026-06-29", sport: "Carrom", standard: "V",
      students: [{ studentId: "stu1", status: "present" }],
    });

    expect(result).toEqual({ saved: 1 });
    expect(repo.runInTransaction).toHaveBeenCalledTimes(1);
    const ops = repo.bulkUpsertAttendance.mock.calls[0][0];
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[0].updateOne.filter).toMatchObject({
      trainerId: "t1", date: "2026-06-29", subjectType: "student", studentId: "stu1",
    });
  });

  test("duplicate prevention — re-marking the same student is an idempotent upsert", async () => {
    repo.bulkUpsertAttendance.mockResolvedValue({ ok: 1 });
    const body = { date: "2026-06-29", sport: "Carrom", standard: "V", students: [{ studentId: "stu1", status: "present" }] };

    await service.markAttendance(eff, body);
    await service.markAttendance(eff, body);

    // Both calls produce an UPSERT keyed on the unique (trainer,date,sport,
    // standard,subjectType,studentId) tuple → the DB updates the same row, never
    // inserts a duplicate.
    for (const call of repo.bulkUpsertAttendance.mock.calls) {
      const op = call[0][0].updateOne;
      expect(op.upsert).toBe(true);
      expect(op.filter).toMatchObject({ subjectType: "student", studentId: "stu1" });
    }
  });

  test("validation — self=absent without a reason → 400, no write", async () => {
    await expect(service.markAttendance(eff, { date: "2026-06-29", self: "absent", selfReason: "  " }))
      .rejects.toMatchObject({ status: 400 });
    expect(repo.bulkUpsertAttendance).not.toHaveBeenCalled();
  });
});

describe("getStudentProgressReport", () => {
  const actor = { clubId: "club1", isCoach: false, allowedSports: null };

  test("happy path — assembles the report from repo data", async () => {
    repo.findStudentById.mockResolvedValue({ _id: "stu1", name: "Aarav", rollNo: "1", standard: "V" });
    repo.findSyllabusEntries.mockResolvedValue([{ _id: "e1", sport: "Carrom", weekNumber: 1, topic: "Strike" }]);
    repo.findStudentProgress.mockResolvedValue([{ syllabusEntryId: "e1", stars: 4, remark: "" }]);
    repo.findProgressHistory.mockResolvedValue([]);
    repo.findClubProfile.mockResolvedValue({ clubName: "Green School" });

    const report = await service.getStudentProgressReport(actor, "stu1", {});

    expect(report.student.name).toBe("Aarav");
    expect(report.schoolName).toBe("Green School");
    expect(report.sports).toHaveLength(1);
    expect(report.sports[0]).toMatchObject({ sport: "Carrom", average: 4, rated: 1 });
    expect(report.overall.rated).toBe(1);
  });

  test("student not found → 404", async () => {
    repo.findStudentById.mockResolvedValue(null);
    await expect(service.getStudentProgressReport(actor, "ghost", {}))
      .rejects.toMatchObject({ name: "ServiceError", status: 404 });
  });
});
