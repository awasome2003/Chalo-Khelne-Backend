const mongoose = require("mongoose");
const escapeRegex = require("../utils/escapeRegex");
const Trainer = require("../Modal/Trainer");
const Session = require("../Modal/Session");
const Request = require("../Modal/Request");
const Club = require("../Modal/Club");
const ClubRequest = require("../Modal/ClubRequest");
const TrainerBatch = require("../Modal/TrainerBatch");
const User = require("../Modal/User");

// ── helpers ───────────────────────────────────────────────
const isId = (v) => mongoose.Types.ObjectId.isValid(v);

const SPORT_EMOJI = {
  football: "⚽",
  soccer: "⚽",
  cricket: "🏏",
  badminton: "🏸",
  tennis: "🎾",
  "table tennis": "🏓",
  "table-tennis": "🏓",
  swimming: "🏊",
  basketball: "🏀",
  volleyball: "🏐",
  hockey: "🏑",
  athletics: "🏃",
};
const sportEmoji = (s) => SPORT_EMOJI[(s || "").toLowerCase()] || "🏅";

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  let h = dt.getHours();
  const m = dt.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDateLong = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return `${DAYS[dt.getDay()]}, ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

// Session.status → screen label
const sessionLabel = (s) => {
  const now = new Date();
  if (s.status === "completed") return "Done";
  if (s.status === "cancelled") return "Cancelled";
  if (s.status === "in-progress") return "Live";
  if (s.startTime && s.endTime && now >= new Date(s.startTime) && now <= new Date(s.endTime)) {
    return "Live";
  }
  return "Upcoming";
};

const typeLabel = (t) =>
  ({ personal: "Personal", group: "Group", intermediate: "Group", academy: "Academy" }[t] || "Personal");

// Find the user's Trainer profile, creating a minimal one if it doesn't exist.
const ensureTrainer = async (userId) => {
  let trainer = await Trainer.findOne({ userId });
  if (!trainer) {
    const u = await User.findById(userId).select("name");
    const parts = (u?.name || "Trainer").trim().split(/\s+/);
    try {
      trainer = await Trainer.create({
        userId,
        firstName: parts[0] || "Trainer",
        lastName: parts.slice(1).join(" "),
      });
    } catch (e) {
      // userId is uniquely indexed — a concurrent request may have just
      // created it. Fall back to reading the now-existing profile.
      if (e.code === 11000) trainer = await Trainer.findOne({ userId });
      else throw e;
    }
  }
  return trainer;
};

const mapSession = (s) => ({
  id: String(s._id),
  title: s.title,
  sport: s.sportType,
  icon: sportEmoji(s.sportType),
  type: typeLabel(s.type),
  date: fmtDateLong(s.startTime),
  time: `${fmtTime(s.startTime)} – ${fmtTime(s.endTime)}`,
  startLabel: fmtTime(s.startTime),
  venue: s.location,
  current: s.currentParticipants || (s.players ? s.players.length : 0),
  max: s.maxParticipants || (s.type === "personal" ? 1 : 0),
  status: sessionLabel(s),
});

const trainerConsoleController = {
  // ── trainer identity ──
  me: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const trainer = await ensureTrainer(userId);
      res.json({ success: true, trainerId: String(trainer._id), trainer });
    } catch (err) {
      console.error("[TRAINER] me:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── dashboard ──
  dashboard: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const trainer = await ensureTrainer(userId);
      const tId = trainer._id;
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [sessions, todayDocs, playerReqPending, clubReqPending, completedThisMonth, batches] =
        await Promise.all([
          Session.find({ trainerId: tId, status: { $ne: "cancelled" } }).lean(),
          Session.find({ trainerId: tId, startTime: { $gte: startOfDay, $lt: endOfDay } })
            .sort({ startTime: 1 })
            .lean(),
          Request.countDocuments({ trainerId: userId, type: "player", status: "pending" }),
          ClubRequest.countDocuments({ trainerId: userId, kind: "invite", status: "pending" }),
          Session.find({ trainerId: tId, status: "completed", startTime: { $gte: startOfMonth } }).lean(),
          TrainerBatch.find({ trainerId: userId }).lean(),
        ]);

      const upcomingSessions = sessions.filter(
        (s) => s.status === "scheduled" && new Date(s.startTime) >= startOfDay
      ).length;

      const playerSet = new Set();
      sessions.forEach((s) => (s.players || []).forEach((p) => playerSet.add(String(p))));
      batches.forEach((b) => (b.enrolledPlayers || []).forEach((p) => playerSet.add(String(p))));

      const monthlyEarnings = completedThisMonth.reduce((sum, s) => sum + (s.price || 0), 0);

      const recentDocs = await Request.find({ trainerId: userId, type: "player" })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const recentRequests = recentDocs.map((r) => ({
        id: String(r._id),
        name: r.playerName || "Player",
        sport: r.sportType || "",
        type: typeLabel(r.sessionType),
        status: r.status,
      }));

      res.json({
        success: true,
        stats: {
          upcomingSessions,
          activePlayers: playerSet.size,
          pendingRequests: playerReqPending + clubReqPending,
          monthlyEarnings,
        },
        todaySessions: todayDocs.map(mapSession),
        recentRequests,
      });
    } catch (err) {
      console.error("[TRAINER] dashboard:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── sessions ──
  listSessions: async (req, res) => {
    try {
      const { userId } = req.params;
      const { status } = req.query; // all | upcoming | live | completed
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const trainer = await ensureTrainer(userId);
      // Per-trainer scan, bounded to the newest 200 (status is a derived label
      // computed after mapping, so page/skip semantics don't compose here).
      let docs = await Session.find({ trainerId: trainer._id })
        .sort({ startTime: -1 })
        .limit(200)
        .lean();
      let sessions = docs.map(mapSession);
      if (status && status !== "all") {
        const want = { upcoming: "Upcoming", live: "Live", completed: "Done" }[status];
        sessions = sessions.filter((s) => s.status === want);
      }
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  createSession: async (req, res) => {
    try {
      const userId = req.body.userId || req.user?.id || req.user?._id;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const trainer = await ensureTrainer(userId);

      const {
        title,
        sport,
        type = "personal",
        date,
        startTime,
        endTime,
        venue,
        maxPlayers,
        price,
        notes,
      } = req.body;

      if (!title || !title.trim())
        return res.status(400).json({ success: false, message: "Session name is required" });
      if (!sport) return res.status(400).json({ success: false, message: "Sport is required" });
      if (!date) return res.status(400).json({ success: false, message: "Date is required" });

      // Combine date (yyyy-mm-dd) with HH:MM times into Date objects
      const mkDate = (t, fallbackH) => {
        if (t && /^\d{1,2}:\d{2}/.test(t)) return new Date(`${date}T${t.length === 4 ? "0" + t : t}:00`);
        const d = new Date(`${date}T00:00:00`);
        d.setHours(fallbackH, 0, 0, 0);
        return d;
      };
      const start = mkDate(startTime, 9);
      const end = mkDate(endTime, 10);

      const session = await Session.create({
        title: title.trim(),
        type,
        startTime: start,
        endTime: end,
        location: (venue && venue.trim()) || "TBA",
        trainerId: trainer._id,
        players: [],
        sportType: sport,
        maxParticipants: type === "personal" ? 1 : Number(maxPlayers) || 0,
        currentParticipants: 0,
        price: Number(price) || 0,
        notes: notes || "",
      });

      res.status(201).json({ success: true, message: "Session created", session: mapSession(session) });
    } catch (err) {
      console.error("[TRAINER] createSession:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── batches ──
  listBatches: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const docs = await TrainerBatch.find({ trainerId: userId }).sort({ createdAt: -1 }).lean();
      const batches = docs.map((b) => ({
        id: String(b._id),
        name: b.name,
        sport: b.sport,
        icon: sportEmoji(b.sport),
        level: b.level,
        capacity: b.capacity,
        enrolled: b.enrolledCount,
        percent: b.capacity ? Math.round((b.enrolledCount / b.capacity) * 100) : 0,
        scheduleDays: b.scheduleDays,
        time: b.startTime && b.endTime ? `${b.startTime}–${b.endTime}` : "",
        location: b.location,
      }));
      res.json({ success: true, batches });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  createBatch: async (req, res) => {
    try {
      const userId = req.body.userId || req.user?.id || req.user?._id;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const { name, sport, level, capacity, scheduleDays, startTime, endTime, location, monthlyFee, description } =
        req.body;
      if (!name || !name.trim())
        return res.status(400).json({ success: false, message: "Batch name is required" });
      const batch = await TrainerBatch.create({
        trainerId: userId,
        name: name.trim(),
        sport: sport || "",
        level: level || "beginner",
        capacity: Number(capacity) || 0,
        scheduleDays: Array.isArray(scheduleDays) ? scheduleDays : [],
        startTime: startTime || "",
        endTime: endTime || "",
        location: location || "",
        monthlyFee: Number(monthlyFee) || 0,
        description: description || "",
      });
      res.status(201).json({ success: true, message: "Batch created", batch });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── requests (player + club + event) ──
  listRequests: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const { type = "player" } = req.query;

      // Per-trainer scans, bounded to the newest 100 of each.
      const [playerDocs, clubDocs] = await Promise.all([
        Request.find({ trainerId: userId, type: "player" }).sort({ createdAt: -1 }).limit(100).lean(),
        ClubRequest.find({ trainerId: userId, kind: "invite" })
          .populate("clubId", "name location")
          .sort({ createdAt: -1 })
          .limit(100)
          .lean(),
      ]);

      const counts = {
        player: playerDocs.filter((r) => r.status === "pending").length,
        club: clubDocs.filter((r) => r.status === "pending").length,
        event: 0,
      };

      let requests = [];
      if (type === "player") {
        requests = playerDocs.map((r) => ({
          id: String(r._id),
          kind: "player",
          name: r.playerName || "Player",
          sport: r.sportType || "",
          icon: sportEmoji(r.sportType),
          type: typeLabel(r.sessionType),
          date: r.requestedDate || "",
          time: r.requestedTime || "",
          location: r.location || "",
          notes: r.notes || "",
          status: r.status,
        }));
      } else if (type === "club") {
        requests = clubDocs.map((r) => ({
          id: String(r._id),
          kind: "club",
          name: r.clubName || r.clubId?.name || "Club",
          sport: r.sport || "",
          icon: sportEmoji(r.sport),
          type: "Club Invite",
          location: r.clubId?.location || "",
          notes: r.message || "",
          status: r.status,
        }));
      } // event → empty for now

      res.json({ success: true, counts, requests });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  respondPlayerRequest: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid request id" });
      if (!["accepted", "rejected"].includes(status))
        return res.status(400).json({ success: false, message: "status must be accepted or rejected" });
      const reqDoc = await Request.findById(id);
      if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });
      reqDoc.status = status;
      await reqDoc.save();
      res.json({ success: true, message: `Request ${status}`, request: reqDoc });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  respondClubRequest: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid request id" });
      if (!["accepted", "rejected"].includes(status))
        return res.status(400).json({ success: false, message: "status must be accepted or rejected" });
      const cr = await ClubRequest.findById(id);
      if (!cr) return res.status(404).json({ success: false, message: "Request not found" });
      cr.status = status;
      await cr.save();
      res.json({ success: true, message: `Request ${status}`, request: cr });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── clubs directory ──
  listClubs: async (req, res) => {
    try {
      const { sport, q, hiring } = req.query;
      const filter = {};
      if (sport && sport !== "All") filter.sports = sport;
      if (hiring === "true") filter.isHiring = true;
      if (q && q.trim()) {
        const rx = new RegExp(escapeRegex(q.trim()), "i");
        filter.$or = [{ name: rx }, { location: rx }];
      }
      const clubs = await Club.find(filter).sort({ membersCount: -1 }).lean();

      // mark which clubs the trainer already applied to
      const userId = req.query.userId;
      let appliedSet = new Set();
      if (isId(userId)) {
        const applied = await ClubRequest.find({ trainerId: userId, kind: "application" })
          .select("clubId")
          .lean();
        appliedSet = new Set(applied.map((a) => String(a.clubId)));
      }

      res.json({
        success: true,
        clubs: clubs.map((c) => ({
          id: String(c._id),
          name: c.name,
          shortCode: c.shortCode || c.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
          logoColor: c.logoColor,
          location: c.location,
          members: c.membersCount,
          sports: c.sports,
          amenities: c.amenities,
          isHiring: c.isHiring,
          applied: appliedSet.has(String(c._id)),
        })),
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  applyToClub: async (req, res) => {
    try {
      const userId = req.body.userId || req.user?.id || req.user?._id;
      const { clubId, message } = req.body;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      if (!isId(clubId)) return res.status(400).json({ success: false, message: "Invalid club id" });
      const club = await Club.findById(clubId);
      if (!club) return res.status(404).json({ success: false, message: "Club not found" });

      try {
        const cr = await ClubRequest.create({
          trainerId: userId,
          clubId,
          clubName: club.name,
          sport: (club.sports || [])[0] || "",
          kind: "application",
          status: "pending",
          message: message || "",
        });
        res.status(201).json({ success: true, message: "Application sent", request: cr });
      } catch (e) {
        if (e.code === 11000)
          return res.status(409).json({ success: false, message: "You already applied to this club" });
        throw e;
      }
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── earnings (derived from sessions) ──
  earnings: async (req, res) => {
    try {
      const { userId } = req.params;
      const { period = "this_month" } = req.query;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const trainer = await ensureTrainer(userId);
      const tId = trainer._id;
      const now = new Date();

      const monthStart = (offset) => new Date(now.getFullYear(), now.getMonth() + offset, 1);
      let start, end;
      if (period === "last_month") {
        start = monthStart(-1);
        end = monthStart(0);
      } else if (period === "all_time") {
        start = new Date(0);
        end = new Date(now.getFullYear() + 100, 0, 1);
      } else {
        start = monthStart(0);
        end = monthStart(1);
      }
      const inWin = (d) => {
        const t = new Date(d);
        return t >= start && t < end;
      };

      // Needs full history (all-time total + month-over-month), so it can't be
      // scoped to the selected period. Bounded to the newest 5000 as a backstop
      // (well beyond any real trainer's session count).
      const all = await Session.find({ trainerId: tId }).sort({ startTime: -1 }).limit(5000).lean();
      const completed = all.filter((s) => s.status === "completed");
      const periodCompleted = completed.filter((s) => inWin(s.startTime));

      const sumPrice = (arr) => arr.reduce((a, s) => a + (s.price || 0), 0);
      const earned = sumPrice(periodCompleted);
      const pending = sumPrice(
        all.filter((s) => (s.status === "scheduled" || s.status === "in-progress") && inWin(s.startTime))
      );
      const sessionsDone = periodCompleted.length;
      const totalEarned = sumPrice(completed);

      // % vs last month (always month-over-month, regardless of selected period)
      const thisMonthEarned = sumPrice(
        completed.filter((s) => new Date(s.startTime) >= monthStart(0) && new Date(s.startTime) < monthStart(1))
      );
      const lastMonthEarned = sumPrice(
        completed.filter((s) => new Date(s.startTime) >= monthStart(-1) && new Date(s.startTime) < monthStart(0))
      );
      const pct = lastMonthEarned > 0 ? Number(((thisMonthEarned - lastMonthEarned) / lastMonthEarned) * 100).toFixed(1) : null;

      // payment sources for the period
      const src = { players: 0, clubs: 0, events: 0, academy: 0 };
      periodCompleted.forEach((s) => {
        if (s.clubId) src.clubs += s.price || 0;
        else if (s.type === "academy") src.academy += s.price || 0;
        else src.players += s.price || 0;
      });
      const srcTotal = src.players + src.clubs + src.events + src.academy || 1;
      const sources = {
        players: Math.round((src.players / srcTotal) * 100),
        clubs: Math.round((src.clubs / srcTotal) * 100),
        events: Math.round((src.events / srcTotal) * 100),
        academy: Math.round((src.academy / srcTotal) * 100),
      };

      const transactions = periodCompleted
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        .slice(0, 15)
        .map((s) => ({
          id: String(s._id),
          title: s.title,
          date: `${new Date(s.startTime).getDate()} ${MONTHS[new Date(s.startTime).getMonth()]} ${new Date(s.startTime).getFullYear()}`,
          amount: s.price || 0,
          source: s.clubId ? "clubs" : s.type === "academy" ? "academy" : "players",
        }));

      res.json({
        success: true,
        earned,
        pending,
        sessionsDone,
        totalEarned,
        pct,
        sources,
        transactions,
      });
    } catch (err) {
      console.error("[TRAINER] earnings:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = trainerConsoleController;
