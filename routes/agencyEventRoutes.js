/**
 * Event OS — AgencyEvent + Event checklist routes.  Mounted at /api/agency-events.
 * Auth: unifiedAuth (token → user + RBAC role). Permission-guarded throughout.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/agencyEventController");
const tasks = require("../controllers/eventTaskController");
const officials = require("../controllers/eventOfficialController");
const staff = require("../controllers/eventStaffController");
const venues = require("../controllers/eventVenueController");
const equipment = require("../controllers/eventEquipmentController");
const registrations = require("../controllers/eventRegistrationController");
const finance = require("../controllers/eventFinanceController");
const sponsors = require("../controllers/eventSponsorController");
const reports = require("../controllers/eventReportController");
const { unifiedAuth, requirePermission } = require("../middleware/rbacMiddleware");

router.use(unifiedAuth);

// Dashboard + directory (must precede "/:id")
router.get("/dashboard/summary", requirePermission("event:read"), ctrl.dashboardSummary);
router.get("/accounts", requirePermission("event:read"), ctrl.affiliatedAccounts);

// Event CRUD
router.get("/", requirePermission("event:read"), ctrl.listEvents);
router.post("/", requirePermission("event:create"), ctrl.createEvent);
router.post("/from-tournament", requirePermission("event:create"), ctrl.createEventFromTournament);
router.get("/:id", requirePermission("event:read"), ctrl.getEvent);
router.patch("/:id", requirePermission("event:update"), ctrl.updateEvent);
router.delete("/:id", requirePermission("event:delete"), ctrl.deleteEvent);

// Teams & Players directory (registrations synced from the linked tournament)
router.get("/:id/directory", requirePermission("event:read"), ctrl.eventDirectory);

// Event checklist / tasks
router.get("/:id/tasks", requirePermission("event:read"), tasks.listTasks);
router.post("/:id/tasks", requirePermission("event:manage"), tasks.createTask);
router.post("/:id/tasks/seed-checklist", requirePermission("event:manage"), tasks.seedChecklist);
router.patch("/:id/tasks/:taskId", requirePermission("event:manage"), tasks.updateTask);
router.delete("/:id/tasks/:taskId", requirePermission("event:manage"), tasks.deleteTask);

// Officials Hub
router.get("/:id/officials", requirePermission("event:read"), officials.list);
router.post("/:id/officials", requirePermission("event:manage"), officials.create);
router.patch("/:id/officials/:officialId", requirePermission("event:manage"), officials.update);
router.delete("/:id/officials/:officialId", requirePermission("event:manage"), officials.remove);

// Staff Hub
router.get("/:id/staff", requirePermission("event:read"), staff.list);
router.post("/:id/staff", requirePermission("event:manage"), staff.create);
router.patch("/:id/staff/:staffId", requirePermission("event:manage"), staff.update);
router.delete("/:id/staff/:staffId", requirePermission("event:manage"), staff.remove);

// Venue Manager
router.get("/:id/venues", requirePermission("event:read"), venues.list);
router.post("/:id/venues", requirePermission("event:manage"), venues.create);
router.post("/:id/venues/seed", requirePermission("event:manage"), venues.seed);
router.patch("/:id/venues/:venueId", requirePermission("event:manage"), venues.update);
router.delete("/:id/venues/:venueId", requirePermission("event:manage"), venues.remove);

// Equipment Log
router.get("/:id/equipment", requirePermission("event:read"), equipment.list);
router.post("/:id/equipment", requirePermission("event:manage"), equipment.create);
router.post("/:id/equipment/seed", requirePermission("event:manage"), equipment.seed);
router.patch("/:id/equipment/:itemId", requirePermission("event:manage"), equipment.update);
router.delete("/:id/equipment/:itemId", requirePermission("event:manage"), equipment.remove);

// Registration Desk — approve / reject entrants (reuses booking status transition)
router.get("/:id/registrations", requirePermission("event:read"), registrations.list);
router.patch("/:id/registrations/:bookingId", requirePermission("event:manage"), registrations.decide);

// Finance Ledger — income/expense lines + derived balance sheet
router.get("/:id/finance", requirePermission("event:read"), finance.list);
router.post("/:id/finance", requirePermission("finance:manage"), finance.create);
router.patch("/:id/finance/:entryId", requirePermission("finance:manage"), finance.update);
router.delete("/:id/finance/:entryId", requirePermission("finance:manage"), finance.remove);

// Sponsors Hub — corporate sponsor catalog
router.get("/:id/sponsors", requirePermission("event:read"), sponsors.list);
router.post("/:id/sponsors", requirePermission("sponsor:manage"), sponsors.create);
router.patch("/:id/sponsors/:sponsorId", requirePermission("sponsor:manage"), sponsors.update);
router.delete("/:id/sponsors/:sponsorId", requirePermission("sponsor:manage"), sponsors.remove);

// Reports & Analytics — operational summary + PDF blueprint + participant certificates
router.get("/:id/report/summary", requirePermission("event:read"), reports.summary);
router.get("/:id/report/blueprint.pdf", requirePermission("event:read"), reports.blueprint);
router.get("/:id/report/certificates.pdf", requirePermission("event:read"), reports.certificates);

module.exports = router;
