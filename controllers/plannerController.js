const mongoose = require("mongoose");
const PlannerNote = require("../src/modules/social/models/PlannerNote");
const TurfBooking = require("../src/modules/org/models/TurfBooking");
const Booking = require("../src/modules/tournaments/models/BookingModel");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a free-form time string ("3:30 PM", "3:30 – 5:00 PM", "06:00 – 07:30 AM",
 * "All Day") into a count of minutes-since-midnight. Returns 540 (9 AM) for
 * unparseable / "All Day" inputs so reminders still have a sane firing time.
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 9 * 60;
  const s = timeStr.trim().toLowerCase();
  if (!s || s.includes("all day")) return 9 * 60;

  const m = s.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/);
  if (!m) return 9 * 60;

  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || "0", 10) || 0;
  let ampm = (m[3] || "").toLowerCase();

  // If the first time has no AM/PM but a later AM/PM appears (e.g. "3:30 – 5:00 PM"),
  // inherit the period from the trailing token.
  if (!ampm) {
    const trailing = s.match(/(am|pm)\s*$/);
    if (trailing) ampm = trailing[1];
  }

  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;

  if (isNaN(h) || h < 0 || h > 23) return 9 * 60;
  return h * 60 + min;
}

function computeReminderAt(dateStr, timeStr) {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00`);
  if (isNaN(base.getTime())) return null;
  const minutes = parseTimeToMinutes(timeStr);
  base.setMinutes(base.getMinutes() + minutes);
  return base;
}

function noteToActivity(doc) {
  return {
    id: String(doc._id),
    source: "note",
    title: doc.title,
    sport: doc.sport,
    time: doc.time,
    location: doc.location,
    date: doc.date,
    type: doc.type,
    color: doc.color,
    tag: doc.tag,
    description: doc.description,
    reminder: doc.reminder,
  };
}

function turfBookingToActivity(b) {
  const isoDate =
    b.date instanceof Date && !isNaN(b.date.getTime())
      ? b.date.toISOString().split("T")[0]
      : null;
  return {
    id: `turf-${b._id}`,
    source: "turf-booking",
    title: b.turfName || "Turf Booking",
    sport: b.sport?.name || "Turf",
    time: b.timeSlot || "",
    location: b.turfName || "",
    date: isoDate,
    type: "Turf Booking",
    color: "#34C759",
    tag: b.status || "Booked",
    description: b.notes || "",
    reminder: false,
  };
}

function tournamentBookingToActivity(b) {
  const t = b.tournamentId; // may be populated
  let isoDate = null;
  let locationStr = "";
  let tournamentId = null;
  if (t && typeof t === "object") {
    tournamentId = t._id ? String(t._id) : null;
    if (t.startDate) {
      const d = new Date(t.startDate);
      if (!isNaN(d.getTime())) isoDate = d.toISOString().split("T")[0];
    }
    if (Array.isArray(t.eventLocation)) {
      locationStr = typeof t.eventLocation[0] === "string" ? t.eventLocation[0] : "";
    } else if (typeof t.eventLocation === "string") {
      locationStr = t.eventLocation;
    }
  } else if (b.tournamentId) {
    tournamentId = String(b.tournamentId);
  }
  return {
    id: `tournament-${b._id}`,
    source: "tournament-booking",
    tournamentId,
    title: b.tournamentName || (t && t.title) || "Tournament",
    sport: (t && t.sports?.[0]?.sportName) || b.tournamentType || "Tournament",
    time: (t && t.startTime) || "",
    location: locationStr,
    date: isoDate,
    type: "Match Scheduled",
    color: "#FFCC00",
    tag: b.status || "Registered",
    description: "",
    reminder: false,
    participants: [],
  };
}

// ─── Handlers ───────────────────────────────────────────────────────────────

// Substitute writes are stored against the coach's id so notes survive the
// substitution and the coach sees them in their own planner.
const resolveOwnerId = (req) => {
  if (req.userRole === "Substitute" && req.user?.coachId) return req.user.coachId;
  return req.body.userId || req.user?._id || req.user?.id;
};

exports.createNote = async (req, res) => {
  try {
    const userId = resolveOwnerId(req);
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const body = req.body || {};
    const reminderAt = body.reminder
      ? computeReminderAt(body.date, body.time)
      : null;

    const note = await PlannerNote.create({
      userId,
      title: body.title,
      sport: body.sport || "Personal Note",
      time: body.time || "All Day",
      location: body.location || "",
      date: body.date,
      type: body.type || "Personal Note",
      color: body.color || "#8E8E93",
      tag: body.tag || "Note",
      description: body.description || "",
      reminder: !!body.reminder,
      reminderAt,
      reminderProcessed: false,
    });

    return res.status(201).json({ success: true, note: noteToActivity(note) });
  } catch (err) {
    console.error("[planner] createNote failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid note id" });
    }

    const userId = resolveOwnerId(req);
    const note = await PlannerNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    if (userId && String(note.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const body = req.body || {};
    const fields = [
      "title", "sport", "time", "location", "date", "type", "color", "tag", "description",
    ];
    fields.forEach((f) => {
      if (body[f] !== undefined) note[f] = body[f];
    });

    if (body.reminder !== undefined) note.reminder = !!body.reminder;

    // Recompute reminderAt whenever date / time / reminder flag is touched
    if (
      body.date !== undefined ||
      body.time !== undefined ||
      body.reminder !== undefined
    ) {
      note.reminderAt = note.reminder
        ? computeReminderAt(note.date, note.time)
        : null;
      // Reset processed flag so cron can re-fire if needed
      note.reminderProcessed = false;
      note.reminderSentAt = null;
    }

    await note.save();
    return res.json({ success: true, note: noteToActivity(note) });
  } catch (err) {
    console.error("[planner] updateNote failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid note id" });
    }

    const userId = resolveOwnerId(req);
    const note = await PlannerNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    if (userId && String(note.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await note.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    console.error("[planner] deleteNote failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getNoteById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid note id" });
    }
    const note = await PlannerNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    return res.json({ success: true, note: noteToActivity(note) });
  } catch (err) {
    console.error("[planner] getNoteById failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Merged feed for the Planner UI. Returns notes + the user's turf bookings +
 * tournament registrations, all normalized to the activity shape the UI expects.
 *
 * Query params:
 *   from, to  — optional YYYY-MM-DD bounds (inclusive). When absent, no date filter.
 *   sources   — optional comma-separated subset of {note, turf-booking, tournament-booking}.
 */
exports.getFeed = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    const requestedSources = String(req.query.sources || "note,turf-booking,tournament-booking")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const wants = (s) => requestedSources.includes(s);

    const tasks = [];

    // Planner notes
    if (wants("note")) {
      const filter = { userId };
      if (from) filter.date = { ...(filter.date || {}), $gte: from };
      if (to) filter.date = { ...(filter.date || {}), $lte: to };
      tasks.push(
        PlannerNote.find(filter)
          .sort({ date: 1 })
          .lean()
          .then((docs) => docs.map(noteToActivity))
          .catch((e) => {
            console.error("[planner] notes lookup failed:", e);
            return [];
          })
      );
    } else {
      tasks.push(Promise.resolve([]));
    }

    // Turf bookings
    if (wants("turf-booking")) {
      const filter = { userId, status: { $in: ["confirmed", "completed", "pending"] } };
      if (from) filter.date = { ...(filter.date || {}), $gte: new Date(`${from}T00:00:00`) };
      if (to) filter.date = { ...(filter.date || {}), $lte: new Date(`${to}T23:59:59`) };
      tasks.push(
        TurfBooking.find(filter)
          .sort({ date: 1 })
          .lean()
          .then((docs) => docs.map(turfBookingToActivity))
          .catch((e) => {
            console.error("[planner] turf bookings lookup failed:", e);
            return [];
          })
      );
    } else {
      tasks.push(Promise.resolve([]));
    }

    // Tournament registrations
    if (wants("tournament-booking")) {
      const filter = { userId, status: { $ne: "cancelled" } };
      tasks.push(
        Booking.find(filter)
          .populate({
            path: "tournamentId",
            select: "title sports startDate startTime eventLocation",
          })
          .lean()
          .then((docs) => {
            const acts = docs.map(tournamentBookingToActivity).filter((a) => a.date);
            // Apply date range filter after we know the tournament startDate
            return acts.filter((a) => {
              if (from && a.date < from) return false;
              if (to && a.date > to) return false;
              return true;
            });
          })
          .catch((e) => {
            console.error("[planner] tournament bookings lookup failed:", e);
            return [];
          })
      );
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [notes, turfActs, tourActs] = await Promise.all(tasks);

    // Enrich tournament-booking activities with a participants list
    // (option (a) from the design discussion — derived from co-registrants).
    if (tourActs.length > 0) {
      const tournamentIds = Array.from(
        new Set(tourActs.map((a) => a.tournamentId).filter(Boolean))
      );
      if (tournamentIds.length > 0) {
        try {
          const sibling = await Booking.find({
            tournamentId: { $in: tournamentIds },
            status: { $ne: "cancelled" },
          })
            .select("tournamentId userName userId")
            .lean();

          const byTournament = new Map();
          for (const b of sibling) {
            const tid = String(b.tournamentId);
            if (!byTournament.has(tid)) byTournament.set(tid, []);
            byTournament.get(tid).push({
              userName: b.userName,
              userId: b.userId ? String(b.userId) : null,
            });
          }

          const currentUserId = String(req.user?._id || req.user?.id || "");

          tourActs.forEach((a) => {
            const list = byTournament.get(String(a.tournamentId)) || [];
            const seen = new Set();
            const out = [];
            let youInserted = false;
            for (const p of list) {
              const key = p.userId || `name:${p.userName}`;
              if (seen.has(key)) continue;
              seen.add(key);
              if (currentUserId && p.userId === currentUserId && !youInserted) {
                out.unshift("You");
                youInserted = true;
              } else if (p.userName) {
                out.push(p.userName);
              }
            }
            a.participants = out;
          });
        } catch (e) {
          console.error("[planner] participant enrichment failed:", e);
        }
      }
    }

    const activities = [...notes, ...turfActs, ...tourActs]
      .filter((a) => a && a.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ success: true, activities });
  } catch (err) {
    console.error("[planner] getFeed failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
