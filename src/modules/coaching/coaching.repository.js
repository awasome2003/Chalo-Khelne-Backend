"use strict";
/**
 * Coaching repository — PURE data access for the coaching domain.
 *
 * Rules:
 *  • The ONLY place coaching Mongoose calls live. Controllers/services never
 *    touch a model directly.
 *  • No business logic, no validation, no req/res — inputs in, documents out.
 *  • Tenancy is NOT bypassed: every model here carries the tenantScope plugin
 *    (Phase 1, enforce:true), so club-staff queries auto-scope to their clubId
 *    via the AsyncLocalStorage context. We still pass clubId in filters where the
 *    caller already has it (the plugin is a no-op when the filter is explicit).
 *
 * Naming: find* / count* / create* / update* / delete* / aggregate*.
 */
// ── coaching-owned models ──
const Student = require("./models/Student");
const Attendance = require("./models/Attendance");
const StudentProgress = require("./models/StudentProgress");
const ProgressHistory = require("./models/ProgressHistory");
const SyllabusEntry = require("./models/SyllabusEntry");
const TrainingSchedule = require("./models/TrainingSchedule");
// ── CROSS-MODULE READS (org / identity) — TRACKED BOUNDARY DEBT (Phase 4) ──
// The only real cross-module model imports in the codebase today. Read-only
// reference lookups; no writes → LOW risk. When the `org` module is built
// (Phase 5+), route these through org's public service interface instead of
// importing its models here. Centralized so it's a single, obvious seam.
const ClubSport = require("../org/models/ClubSport"); // org
const ClubAdminProfile = require("../org/models/ClubAdminProfile"); // org
const { Manager } = require("../identity/models/ClubManager"); // identity/org
const { tenantMatchStage } = require("../../../utils/tenantContext");
// Shared transaction helper now lives in platform/ (single source of truth).
const { runInTransaction } = require("../../platform/db");

// ── Students ─────────────────────────────────────────────────────────
const countStudents = (clubId, standard) =>
  Student.countDocuments({ clubId, standard });

const createStudent = (data) => Student.create(data);

const findStudents = (filter, sort = {}) =>
  Student.find(filter).sort(sort).lean();

const findStudentById = (clubId, id, projection = "") =>
  Student.findOne({ _id: id, clubId }).select(projection).lean();

const findStudentsByIds = (ids, projection = "") =>
  Student.find({ _id: { $in: ids } }).select(projection).lean();

const aggregateStandards = () =>
  Student.aggregate([
    ...tenantMatchStage(), // tenant scope for aggregate (plugin doesn't cover it)
    { $group: { _id: "$standard", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

const deleteStudent = (clubId, id) => Student.deleteOne({ _id: id, clubId });

const deleteStudentsByStandard = (clubId, standard, session = null) =>
  Student.deleteMany({ clubId, standard }, session ? { session } : {});

const insertStudents = (docs, session = null) =>
  Student.insertMany(docs, session ? { session } : {});

// ── Attendance ───────────────────────────────────────────────────────
const findAttendance = (filter, sort = {}) =>
  Attendance.find(filter).sort(sort).lean();

const bulkUpsertAttendance = (ops, session = null) =>
  Attendance.bulkWrite(ops, session ? { session } : {});

// ── Progress / Syllabus ──────────────────────────────────────────────
const findSyllabusEntries = (filter, projection = "", sort = {}) =>
  SyllabusEntry.find(filter).select(projection).sort(sort).lean();

const countSyllabusEntries = (filter) => SyllabusEntry.countDocuments(filter);

const findStudentProgress = (filter, projection = "") =>
  StudentProgress.find(filter).select(projection).lean();

const findProgressHistory = (filter, sort = {}) =>
  ProgressHistory.find(filter).sort(sort).lean();

// ── Cross-model lookups used by coaching services ────────────────────
const findClubProfile = (userId, projection = "") =>
  ClubAdminProfile.findOne({ userId }).select(projection).lean();

const findClubSportsForTrainer = (clubId, trainerId) =>
  ClubSport.find({ clubId, "trainers.trainer": trainerId }).select("name").lean();

const findManagersByIds = (ids, projection = "") =>
  Manager.find({ _id: { $in: ids } }).select(projection).lean();

const findTrainingSchedule = (clubId, projection = "") =>
  TrainingSchedule.find({ clubId }).select(projection).lean();

module.exports = {
  runInTransaction,
  // students
  countStudents,
  createStudent,
  findStudents,
  findStudentById,
  findStudentsByIds,
  aggregateStandards,
  deleteStudent,
  deleteStudentsByStandard,
  insertStudents,
  // attendance
  findAttendance,
  bulkUpsertAttendance,
  // progress / syllabus
  findSyllabusEntries,
  countSyllabusEntries,
  findStudentProgress,
  findProgressHistory,
  // cross-model
  findClubProfile,
  findClubSportsForTrainer,
  findManagersByIds,
  findTrainingSchedule,
};
