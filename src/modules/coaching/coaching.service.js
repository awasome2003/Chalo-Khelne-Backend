"use strict";
/**
 * Coaching service — ALL coaching business logic.
 *
 *  • Validation, business rules, cross-model orchestration, transactions.
 *  • Calls the repository only — never Mongoose directly.
 *  • Knows nothing about req/res. Throws ServiceError(status, message); the
 *    controller maps that to an HTTP response.
 */
const repo = require("./coaching.repository");

class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

// ── domain helpers (pure) ────────────────────────────────────────────
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOf = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};
const avg = (nums) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;
const mayUseSport = (actor, sport) =>
  !actor.isCoach || (actor.allowedSports || []).includes(sport);

// Pull a student name + roll no out of a parsed Excel row (flexible headers).
function extractStudent(row) {
  const keys = Object.keys(row);
  const rollKey = keys.find((k) => /roll/i.test(k));
  let nameKey = keys.find((k) => /name/i.test(k));
  if (!nameKey) nameKey = keys.find((k) => k !== rollKey && !/^sr|^s\.?no|^no\.?$|serial|^#/i.test(k));
  if (!nameKey) nameKey = keys[0];
  return {
    name: String(row[nameKey] ?? "").trim(),
    rollNo: rollKey ? String(row[rollKey] ?? "").trim() : "",
  };
}

const ORG_TYPES = new Set(["school", "organization"]);

// ── identity resolvers (DB-backed → live in the service, not the controller) ──

/** A school/organization admin manages students/attendance. Returns clubId. */
async function resolveSchoolOrgAdmin(user) {
  if (!user || (user.role !== "ClubAdmin" && user.role !== "corporate_admin")) {
    throw new ServiceError(403, "School or organization admin access required.");
  }
  const clubId = String(user._id);
  const profile = await repo.findClubProfile(clubId, "orgType");
  if (!ORG_TYPES.has(profile?.orgType || "club")) {
    throw new ServiceError(403, "Only school or organization admins can manage students.");
  }
  return clubId;
}

/**
 * Resolve the progress actor: a coach (scoped to their assigned sports) or a
 * school/org admin (all sports). `eff` is the pure effectiveTrainer(req) result.
 */
async function resolveProgressActor({ user, eff }) {
  if (eff && eff.trainerId) {
    const sports = await repo.findClubSportsForTrainer(eff.clubId, eff.trainerId);
    return {
      clubId: String(eff.clubId),
      trainerId: eff.trainerId,
      isCoach: true,
      allowedSports: sports.map((s) => s.name),
    };
  }
  if (user && (user.role === "ClubAdmin" || user.role === "corporate_admin")) {
    const profile = await repo.findClubProfile(String(user._id), "orgType");
    if (ORG_TYPES.has(profile?.orgType || "club")) {
      return { clubId: String(user._id), trainerId: null, isCoach: false, allowedSports: null };
    }
  }
  throw new ServiceError(403, "Trainer or school/organization admin access required.");
}

// ── Students ─────────────────────────────────────────────────────────
async function listStandards() {
  const agg = await repo.aggregateStandards();
  return agg.map((a) => ({ standard: a._id, count: a.count }));
}

async function listStudents(clubId, { standard } = {}) {
  const q = { clubId };
  if (standard) q.standard = standard;
  return repo.findStudents(q, { standard: 1, order: 1, name: 1 });
}

async function createStudent(clubId, { name, standard, rollNo }) {
  const cleanName = String(name || "").trim();
  const cleanStandard = String(standard || "").trim();
  if (!cleanName || !cleanStandard) {
    throw new ServiceError(400, "Name and standard are required.");
  }
  // order = append to the end of the standard's roster.
  const order = await repo.countStudents(clubId, cleanStandard);
  return repo.createStudent({
    clubId,
    standard: cleanStandard,
    name: cleanName,
    rollNo: String(rollNo || "").trim(),
    order,
  });
}

async function deleteStudent(clubId, id) {
  const r = await repo.deleteStudent(clubId, id);
  if (r.deletedCount === 0) throw new ServiceError(404, "Student not found.");
  return { success: true };
}

async function deleteStandard(clubId, standard) {
  const s = String(standard || "").trim();
  if (!s) throw new ServiceError(400, "standard is required.");
  const r = await repo.deleteStudentsByStandard(clubId, s);
  return { deleted: r.deletedCount };
}

/**
 * Replace a standard's roster from parsed Excel rows — atomically.
 * deleteMany + insertMany must both succeed or neither (TRANSACTION).
 */
async function replaceStandardRoster(clubId, standard, rows) {
  const cleanStandard = String(standard || "").trim();
  if (!cleanStandard) throw new ServiceError(400, "Standard is required.");
  const students = (rows || [])
    .map(extractStudent)
    .filter((s) => s.name)
    .map((s, i) => ({ clubId, standard: cleanStandard, name: s.name, rollNo: s.rollNo, order: i }));
  if (students.length === 0) {
    throw new ServiceError(400, "No student names found. Add a 'Name' column header.");
  }
  await repo.runInTransaction(async (session) => {
    await repo.deleteStudentsByStandard(clubId, cleanStandard, session);
    await repo.insertStudents(students, session);
  });
  return { standard: cleanStandard, count: students.length };
}

// ── Attendance ───────────────────────────────────────────────────────
function requireTrainer(eff) {
  if (!eff || !eff.trainerId) throw new ServiceError(403, "Trainer access required.");
}

async function getAttendanceSession(eff, { date, sport = "", standard = "" }) {
  requireTrainer(eff);
  if (!date) throw new ServiceError(400, "date is required.");
  const records = await repo.findAttendance({ trainerId: eff.trainerId, date, sport, standard });
  let self = null;
  let selfReason = "";
  const students = {};
  for (const r of records) {
    if (r.subjectType === "self") {
      self = r.status;
      selfReason = r.reason || "";
    } else if (r.studentId) {
      students[String(r.studentId)] = r.status;
    }
  }
  return { self, selfReason, students };
}

/**
 * Mark attendance for a session. Idempotent: each row is an UPSERT keyed on the
 * unique (trainer,date,sport,standard,subjectType,studentId) — re-marking
 * updates the same record instead of creating duplicates. The batch is written
 * inside a transaction (multi-document write).
 */
async function markAttendance(eff, { date, sport = "", standard = "", self, selfReason = "", students = [] }) {
  requireTrainer(eff);
  if (!date) throw new ServiceError(400, "date is required.");
  if (self === "absent" && !String(selfReason).trim()) {
    throw new ServiceError(400, "Please provide a reason for your absence.");
  }

  const base = { clubId: eff.clubId, trainerId: eff.trainerId, date, sport, standard };
  const ops = [];

  if (self === "present" || self === "absent") {
    ops.push({
      updateOne: {
        filter: { ...base, subjectType: "self", studentId: null },
        update: {
          $set: {
            ...base,
            subjectType: "self",
            studentId: null,
            status: self,
            reason: self === "absent" ? String(selfReason).trim() : "",
          },
        },
        upsert: true,
      },
    });
  }
  for (const s of Array.isArray(students) ? students : []) {
    if (!s || !s.studentId || (s.status !== "present" && s.status !== "absent")) continue;
    ops.push({
      updateOne: {
        filter: { ...base, subjectType: "student", studentId: s.studentId },
        update: { $set: { ...base, subjectType: "student", studentId: s.studentId, status: s.status } },
        upsert: true,
      },
    });
  }

  if (ops.length) {
    await repo.runInTransaction((session) => repo.bulkUpsertAttendance(ops, session));
  }
  return { saved: ops.length };
}

// Build a (date,standard,sport) → scheduled-time lookup from a club's timetable.
function timeLookup(schedule) {
  return (date, standard, sport) => {
    const wd = weekdayOf(date);
    const row = schedule.find(
      (r) => r.day === wd && String(r.standard) === String(standard) && (r.sports || []).includes(sport)
    );
    return row ? row.time : "";
  };
}

/** Admin attendance report: records grouped into sessions with student detail. */
async function getAdminAttendance(clubId, { trainerId, date, standard } = {}) {
  const q = { clubId };
  if (trainerId) q.trainerId = trainerId;
  if (date) q.date = date;
  if (standard) q.standard = standard;

  const records = await repo.findAttendance(q, { date: -1 });
  const trainerIds = [...new Set(records.map((r) => String(r.trainerId)))];
  const studentIds = [...new Set(records.filter((r) => r.studentId).map((r) => String(r.studentId)))];
  const [trainers, students, schedule] = await Promise.all([
    repo.findManagersByIds(trainerIds, "name"),
    repo.findStudentsByIds(studentIds, "name rollNo"),
    repo.findTrainingSchedule(clubId, "day standard sports time"),
  ]);
  const trainerName = {};
  trainers.forEach((t) => { trainerName[String(t._id)] = t.name; });
  const studentInfo = {};
  students.forEach((s) => { studentInfo[String(s._id)] = s; });
  const timeOf = timeLookup(schedule);

  const map = {};
  for (const r of records) {
    const key = `${r.date}|${r.trainerId}|${r.sport}|${r.standard}`;
    if (!map[key]) {
      map[key] = {
        date: r.date, trainerId: String(r.trainerId),
        trainerName: trainerName[String(r.trainerId)] || "Trainer",
        sport: r.sport, standard: r.standard,
        time: timeOf(r.date, r.standard, r.sport),
        self: null, selfReason: "", students: [], present: 0, absent: 0,
      };
    }
    const sess = map[key];
    if (r.subjectType === "self") { sess.self = r.status; sess.selfReason = r.reason || ""; }
    else if (r.studentId) {
      const info = studentInfo[String(r.studentId)] || {};
      sess.students.push({ name: info.name || "Student", rollNo: info.rollNo || "", status: r.status });
      if (r.status === "present") sess.present++; else sess.absent++;
    }
  }
  return Object.values(map)
    .map((s) => ({ ...s, total: s.students.length }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The logged-in trainer's own past sessions (most recent 60). */
async function getTrainerHistory(eff) {
  requireTrainer(eff);
  const [records, schedule] = await Promise.all([
    repo.findAttendance({ trainerId: eff.trainerId }, { date: -1 }),
    repo.findTrainingSchedule(eff.clubId, "day standard sports time"),
  ]);
  const timeOf = timeLookup(schedule);
  const map = {};
  for (const r of records) {
    const key = `${r.date}|${r.sport}|${r.standard}`;
    if (!map[key]) {
      map[key] = {
        date: r.date, sport: r.sport, standard: r.standard,
        time: timeOf(r.date, r.standard, r.sport),
        self: null, selfReason: "", present: 0, total: 0,
      };
    }
    const s = map[key];
    if (r.subjectType === "self") { s.self = r.status; s.selfReason = r.reason || ""; }
    else { s.total += 1; if (r.status === "present") s.present += 1; }
  }
  return Object.values(map)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 60);
}

/** School roster for a standard (read-only view for a trainer). */
async function getStudentsForTrainer(eff, standard) {
  requireTrainer(eff);
  const s = String(standard || "").trim();
  if (!s) return [];
  return repo.findStudents({ clubId: eff.clubId, standard: s }, { order: 1, name: 1 });
}

// ── Progress report ──────────────────────────────────────────────────
/** Per-student progress report (all sports for admin; coach's sports if scoped). */
async function getStudentProgressReport(actor, studentId, { sport } = {}) {
  const student = await repo.findStudentById(actor.clubId, studentId, "name rollNo standard");
  if (!student) throw new ServiceError(404, "Student not found.");

  const wantSport = String(sport || "").trim();
  const entryFilter = { clubId: actor.clubId, standard: student.standard };
  if (wantSport) entryFilter.sport = wantSport;

  let entries = await repo.findSyllabusEntries(
    entryFilter, "sport standard weekNumber topic", { sport: 1, weekNumber: 1, order: 1 }
  );
  if (actor.isCoach) entries = entries.filter((e) => (actor.allowedSports || []).includes(e.sport));

  const ratings = await repo.findStudentProgress(
    { clubId: actor.clubId, studentId: student._id }, "syllabusEntryId stars remark"
  );
  const rmap = {};
  ratings.forEach((r) => { rmap[String(r.syllabusEntryId)] = { stars: r.stars, remark: r.remark || "" }; });

  const histFilter = { clubId: actor.clubId, studentId: student._id };
  if (wantSport) histFilter.sport = wantSport;
  let history = await repo.findProgressHistory(histFilter, { submittedAt: 1 });
  if (actor.isCoach) history = history.filter((h) => (actor.allowedSports || []).includes(h.sport));

  const histByEntry = {};
  const bySubmission = {};
  history.forEach((h) => {
    (histByEntry[String(h.syllabusEntryId)] = histByEntry[String(h.syllabusEntryId)] || [])
      .push({ stars: h.stars, remark: h.remark || "", at: h.submittedAt });
    const k = String(h.submissionId);
    (bySubmission[k] = bySubmission[k] || { at: h.submittedAt, stars: [] }).stars.push(h.stars);
  });
  const trend = Object.values(bySubmission)
    .map((s) => ({ at: s.at, average: avg(s.stars) }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  const bySport = {};
  entries.forEach((e) => {
    const r = rmap[String(e._id)];
    (bySport[e.sport] = bySport[e.sport] || []).push({
      weekNumber: e.weekNumber, topic: e.topic,
      stars: r ? r.stars : 0, remark: r ? r.remark : "",
      history: histByEntry[String(e._id)] || [],
    });
  });
  const sports = Object.keys(bySport).sort().map((sportName) => {
    const topics = bySport[sportName];
    const rated = topics.filter((t) => t.stars > 0).map((t) => t.stars);
    return { sport: sportName, topics, total: topics.length, rated: rated.length, average: avg(rated) };
  });
  const allRated = sports.flatMap((s) => s.topics.filter((t) => t.stars > 0).map((t) => t.stars));
  const profile = await repo.findClubProfile(actor.clubId, "clubName").catch(() => null);

  return {
    student,
    schoolName: profile?.clubName || "",
    sports,
    overall: { average: avg(allRated), rated: allRated.length, total: sports.reduce((a, s) => a + s.total, 0) },
    trend,
    submissionCount: trend.length,
  };
}

module.exports = {
  ServiceError,
  // resolvers
  resolveSchoolOrgAdmin,
  resolveProgressActor,
  // students
  listStandards,
  listStudents,
  createStudent,
  deleteStudent,
  deleteStandard,
  replaceStandardRoster,
  // attendance
  getAttendanceSession,
  markAttendance,
  getAdminAttendance,
  getTrainerHistory,
  getStudentsForTrainer,
  // progress
  getStudentProgressReport,
  // exported for unit tests of pure helpers
  _helpers: { weekdayOf, avg, extractStudent, mayUseSport },
};
