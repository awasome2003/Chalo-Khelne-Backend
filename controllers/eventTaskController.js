/**
 * Event checklist / task controller (Event OS, Phase 1).
 * All ops are agency-scoped and verify the event belongs to the caller's agency.
 */
const AgencyEvent = require("../src/modules/events/models/AgencyEvent");
const EventTask = require("../src/modules/events/models/EventTask");
const User = require("../src/modules/identity/models/User");
const { SPORT_TEMPLATES, GENERIC_CHECKLIST } = require("../src/modules/events/data/sportTemplates");

async function resolveAgencyId(req) {
  const uid = req.user?.id || req.user?._id || req.user?.userId;
  if (!uid) return null;
  const user = await User.findById(uid).select("agencyId").lean();
  if (!user) return null;
  return user.agencyId || user._id;
}

async function getScopedEvent(req) {
  const agencyId = await resolveAgencyId(req);
  if (!agencyId) return { agencyId: null, event: null };
  const event = await AgencyEvent.findOne({ _id: req.params.id, agencyId }).lean();
  return { agencyId, event };
}

exports.listTasks = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req);
    if (!agencyId) return res.status(403).json({ success: false, message: "No agency context" });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const tasks = await EventTask.find({ eventId: event._id }).sort({ category: 1, createdAt: 1 }).lean();
    return res.json({ success: true, count: tasks.length, tasks });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.createTask = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!req.body.title) return res.status(400).json({ success: false, message: "Task title is required" });
    const task = await EventTask.create({
      eventId: event._id, agencyId, createdBy: req.user?.id || null,
      title: req.body.title, priority: req.body.priority || "Medium",
      owner: req.body.owner || "", deadline: req.body.deadline || "",
      status: req.body.status || "To Do", category: "task",
    });
    return res.status(201).json({ success: true, task });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.updateTask = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const allowed = ["title", "priority", "status", "owner", "deadline"];
    const update = {};
    for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
    const task = await EventTask.findOneAndUpdate(
      { _id: req.params.taskId, eventId: req.params.id, agencyId }, update,
      { new: true, runValidators: true }
    );
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteTask = async (req, res) => {
  try {
    const agencyId = await resolveAgencyId(req);
    const task = await EventTask.findOneAndDelete({ _id: req.params.taskId, eventId: req.params.id, agencyId });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, message: "Task deleted" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Seed the checklist from the event's sport templates (adds missing items only).
exports.seedChecklist = async (req, res) => {
  try {
    const { agencyId, event } = await getScopedEvent(req);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const sports = (event.sports && event.sports.length) ? event.sports : [];
    const items = []; // { title, sport }
    if (sports.length) {
      for (const sport of sports) {
        const tpl = SPORT_TEMPLATES[sport];
        (tpl ? tpl.checklist : GENERIC_CHECKLIST).forEach((title) => items.push({ title, sport: tpl ? sport : "" }));
      }
    } else {
      GENERIC_CHECKLIST.forEach((title) => items.push({ title, sport: "" }));
    }

    const existing = new Set((await EventTask.find({ eventId: event._id }).select("title").lean()).map((t) => t.title));
    const toCreate = items
      .filter((it) => !existing.has(it.title))
      .map((it) => ({ eventId: event._id, agencyId, title: it.title, sport: it.sport, category: "checklist", priority: "Medium", status: "To Do", createdBy: req.user?.id || null }));

    if (toCreate.length) await EventTask.insertMany(toCreate);
    const tasks = await EventTask.find({ eventId: event._id }).sort({ category: 1, createdAt: 1 }).lean();
    return res.json({ success: true, added: toCreate.length, count: tasks.length, tasks });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
