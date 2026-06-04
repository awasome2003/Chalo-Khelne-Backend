const mongoose = require("mongoose");
const escapeRegex = require("../utils/escapeRegex");
const ProfessionalProfile = require("../Modal/ProfessionalProfile");
const JobPosting = require("../Modal/JobPosting");
const JobApplication = require("../Modal/JobApplication");
const HireRequest = require("../Modal/HireRequest");
const User = require("../Modal/User");
const { Manager } = require("../Modal/ClubManager");
const { parsePagination } = require("../utils/pagination");

// ── helpers ───────────────────────────────────────────────
const uid = (req) => req.user?.id || req.user?._id;
const isId = (v) => mongoose.Types.ObjectId.isValid(v);

// "₹2,500/-" → 2500 ; 2500 → 2500 ; junk → 0
const toAmount = (v) => {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const STATUS_LABEL = {
  pending: "Pending",
  shortlist: "Shortlist",
  accepted: "Accepted",
  rejected: "Rejected",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
};
const parseDate = (s) => {
  if (!s) return null;
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
};
const daysBetween = (a, b) => Math.round((a - b) / (1000 * 60 * 60 * 24));

// Build a frontend-shaped engagement bucket (active / upcoming / completed)
// from an accepted record with a date.
const classifyEngagements = (records) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = { active: [], upcoming: [], completed: [] };

  records.forEach((r) => {
    const dt = parseDate(r.date);
    const base = {
      id: r.id,
      title: r.title,
      event: r.event,
      org: r.org,
      location: r.location,
      time: r.time || "",
      date: r.dateLabel || r.date || "",
      rate: r.rate,
    };
    if (!dt) {
      out.active.push({ ...base, status: "Confirmed" });
      return;
    }
    const dayDiff = daysBetween(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()), today);
    if (dayDiff > 0) {
      out.upcoming.push({
        ...base,
        timeLabel: dayDiff === 1 ? "1 Day left" : `${dayDiff} Days left`,
      });
    } else if (dayDiff === 0) {
      out.active.push({ ...base, status: "In Progress" });
    } else {
      out.completed.push({
        ...base,
        completedOn: shortDate(dt) + " " + dt.getFullYear(),
        earned: r.rate,
        rating: r.rating || 0,
        review: r.review || "",
      });
    }
  });

  return out;
};

const jobsController = {
  // ── Job postings (browse) ──────────────────────────────
  listJobs: async (req, res) => {
    try {
      const { role, sport, q } = req.query;
      const filter = { status: "open" };
      if (role && role !== "All") filter.role = role;
      if (sport && sport !== "All") filter.sport = sport;
      if (q && q.trim()) {
        const rx = new RegExp(escapeRegex(q.trim()), "i");
        filter.$or = [{ title: rx }, { venue: rx }, { location: rx }, { managerName: rx }, { sport: rx }];
      }
      const { page, limit, skip } = parsePagination(req);
      const jobs = await JobPosting.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      res.json({ success: true, jobs, page, hasMore: jobs.length === limit });
    } catch (err) {
      console.error("[JOBS] listJobs:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  getJob: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid job id" });
      const job = await JobPosting.findById(id).lean();
      if (!job) return res.status(404).json({ success: false, message: "Job not found" });
      res.json({ success: true, job });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── Applications ───────────────────────────────────────
  apply: async (req, res) => {
    try {
      const applicantId = req.body.applicantId || uid(req);
      const { jobId, professionalProfileId, coverMessage } = req.body;
      if (!isId(jobId)) return res.status(400).json({ success: false, message: "Invalid job id" });
      if (!isId(applicantId)) return res.status(400).json({ success: false, message: "Invalid applicant" });

      const job = await JobPosting.findById(jobId);
      if (!job) return res.status(404).json({ success: false, message: "Job not found" });

      const dup = await JobApplication.findOne({ jobId, applicantId });
      if (dup) {
        return res.status(409).json({ success: false, message: "You have already applied to this job" });
      }

      const application = await JobApplication.create({
        jobId,
        applicantId,
        professionalProfileId: isId(professionalProfileId) ? professionalProfileId : null,
        coverMessage: (coverMessage || "").trim(),
        status: "pending",
        jobTitle: job.title,
        venue: job.venue,
        sport: job.sport,
        role: job.role,
        rate: job.rate,
        rateUnit: job.rateUnit,
        eventDate: job.schedule?.[0]?.date || "",
      });

      await JobPosting.findByIdAndUpdate(jobId, { $inc: { applicantsCount: 1 } });

      res.status(201).json({ success: true, message: "Application submitted", application });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "You have already applied to this job" });
      }
      console.error("[JOBS] apply:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  getMyApplications: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

      // Stats are full counts (cheap countDocuments), independent of the page.
      const base = { applicantId: userId };
      const { page, limit, skip } = parsePagination(req);
      const [apps, total, pending, shortlist, accepted, rejected] = await Promise.all([
        JobApplication.find(base).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        JobApplication.countDocuments(base),
        JobApplication.countDocuments({ ...base, status: "pending" }),
        JobApplication.countDocuments({ ...base, status: "shortlist" }),
        JobApplication.countDocuments({ ...base, status: "accepted" }),
        JobApplication.countDocuments({ ...base, status: "rejected" }),
      ]);

      const applications = apps.map((a) => ({
        id: String(a._id),
        jobId: String(a.jobId),
        title: a.jobTitle || "Job",
        venue: a.venue || "",
        appliedOn: shortDate(a.createdAt),
        rate: a.rate ? `₹${a.rate.toLocaleString("en-IN")}/-` : "",
        rateUnit: a.rateUnit || "per hour",
        status: STATUS_LABEL[a.status] || "Pending",
      }));

      const stats = { total, pending: pending + shortlist, accepted, rejected };

      res.json({ success: true, stats, applications, page, hasMore: apps.length === limit });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── Professional profiles ──────────────────────────────
  createProfile: async (req, res) => {
    try {
      const userId = req.body.userId || uid(req);
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

      const {
        role,
        sports = [],
        city = "",
        experienceLevel = "intermediate",
        availability = [],
        rateType = "per_hour",
        rateAmount = 0,
        negotiable = false,
        about = "",
        certificates = [],
      } = req.body;

      if (!ProfessionalProfile.ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid or missing role" });
      }

      const payload = {
        userId,
        role,
        sports,
        city,
        experienceLevel,
        availability,
        rateType,
        rateAmount: toAmount(rateAmount),
        negotiable: !!negotiable,
        about,
        certificates,
      };

      // Upsert: one profile per (user, role). Re-submitting the same role edits it.
      let profile = await ProfessionalProfile.findOne({ userId, role });
      if (profile) {
        Object.assign(profile, payload);
        await profile.save();
      } else {
        profile = await ProfessionalProfile.create(payload);
      }

      res.status(201).json({ success: true, message: "Professional profile saved", profile });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "Profile for this role already exists" });
      }
      console.error("[JOBS] createProfile:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  getMyProfiles: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const profiles = await ProfessionalProfile.find({ userId }).sort({ createdAt: -1 }).lean();
      res.json({ success: true, profiles });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  getProfile: async (req, res) => {
    try {
      const { id } = req.params;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid profile id" });
      const profile = await ProfessionalProfile.findById(id)
        .populate("userId", "name profileImage address")
        .lean();
      if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });
      res.json({ success: true, profile });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  setProfileActive: async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid profile id" });
      const profile = await ProfessionalProfile.findByIdAndUpdate(
        id,
        { isActive: !!isActive },
        { new: true }
      );
      if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });
      res.json({ success: true, profile });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Directory of professionals to hire (HireProfessional screen)
  listProfessionals: async (req, res) => {
    try {
      const { role, sport, q } = req.query;
      const filter = { isActive: true };
      if (role && role !== "All") filter.role = role;
      if (sport && sport !== "All") filter.sports = sport;
      const requesterId = uid(req);
      if (isId(requesterId)) filter.userId = { $ne: requesterId };

      const { page, limit, skip } = parsePagination(req);
      let profiles = await ProfessionalProfile.find(filter)
        .populate("userId", "name profileImage address")
        .sort({ rating: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      if (q && q.trim()) {
        const needle = q.trim().toLowerCase();
        profiles = profiles.filter((p) => {
          const hay = [p.userId?.name, p.role, p.city, (p.sports || []).join(" ")]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(needle);
        });
      }

      res.json({ success: true, professionals: profiles, page, hasMore: profiles.length === limit });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── Hire requests ──────────────────────────────────────
  sendHireRequest: async (req, res) => {
    try {
      const fromUserId = req.body.fromUserId || uid(req);
      const { toProfileId, title, role, sport, location, eventDate, duration, offerPayment, description } =
        req.body;
      if (!isId(fromUserId)) return res.status(400).json({ success: false, message: "Invalid sender" });
      if (!isId(toProfileId)) return res.status(400).json({ success: false, message: "Invalid professional" });

      const profile = await ProfessionalProfile.findById(toProfileId);
      if (!profile) return res.status(404).json({ success: false, message: "Professional not found" });
      if (String(profile.userId) === String(fromUserId)) {
        return res.status(400).json({ success: false, message: "You cannot hire yourself" });
      }

      // The sender may be a User (player/clubadmin) or a Manager — look up both
      // so the recipient's inbox shows the real club/manager name, not "A player".
      let sender = await User.findById(fromUserId).select("name");
      if (!sender) sender = await Manager.findById(fromUserId).select("name");

      const request = await HireRequest.create({
        fromUserId,
        fromName: sender?.name || "A player",
        toUserId: profile.userId,
        toProfileId,
        title: title || "",
        role: role || profile.role,
        sport: sport || (profile.sports || [])[0] || "",
        location: location || "",
        eventDate: eventDate || "",
        duration: duration || "",
        offerPayment: offerPayment || "",
        description: description || "",
        status: "pending",
        seen: false,
      });

      const io = req.app.get("io");
      if (io) io.to(`user_${profile.userId}`).emit("hireRequest:new", { _id: request._id, title: request.title });

      res.status(201).json({ success: true, message: "Hire request sent", request });
    } catch (err) {
      console.error("[JOBS] sendHireRequest:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  getReceivedRequests: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });
      const docs = await HireRequest.find({ toUserId: userId }).sort({ createdAt: -1 }).lean();
      const requests = docs.map((r) => ({
        id: String(r._id),
        title: r.title || "Hire Request",
        fromName: r.fromName || "A player",
        role: r.role || "",
        location: r.location || "",
        date: r.eventDate || shortDate(r.createdAt),
        rate: r.offerPayment ? (/[₹]/.test(r.offerPayment) ? r.offerPayment : `₹${r.offerPayment}`) : "",
        status: r.status,
        isNew: !r.seen && r.status === "pending",
      }));
      res.json({ success: true, requests });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  respondHireRequest: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid request id" });
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({ success: false, message: "status must be accepted or rejected" });
      }
      // Ownership (responder must be the recipient) is enforced at the route via
      // requireOwner(toUserId). Make the status transition atomic so concurrent
      // taps can't both succeed and double-emit.
      const request = await HireRequest.findOneAndUpdate(
        { _id: id, status: "pending" },
        { $set: { status, seen: true } },
        { new: true }
      );
      if (!request) {
        const existing = await HireRequest.findById(id).select("status").lean();
        if (!existing) return res.status(404).json({ success: false, message: "Request not found" });
        return res.status(400).json({ success: false, message: `Request already ${existing.status}` });
      }

      const io = req.app.get("io");
      if (io) io.to(`user_${request.fromUserId}`).emit("hireRequest:response", { _id: request._id, status });

      res.json({ success: true, message: `Request ${status}`, request });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // ── Professional dashboard (derived) ───────────────────
  getDashboard: async (req, res) => {
    try {
      const { userId } = req.params;
      if (!isId(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

      const [profiles, acceptedApps, acceptedHires] = await Promise.all([
        ProfessionalProfile.find({ userId }).lean(),
        JobApplication.find({ applicantId: userId, status: "accepted" })
          .populate("jobId", "title sport venue location managerName organizer schedule rate rateUnit")
          .lean(),
        HireRequest.find({ toUserId: userId, status: "accepted" }).lean(),
      ]);

      const records = [];

      acceptedApps.forEach((a) => {
        const job = a.jobId || {};
        records.push({
          id: String(a._id),
          title: a.jobTitle || job.title || "Job",
          event: job.sport || a.sport || "",
          org: job.organizer?.name || job.managerName || job.venue || "",
          location: job.location || job.venue || a.venue || "",
          time: job.schedule?.[0]?.time || "",
          date: a.eventDate || job.schedule?.[0]?.date || "",
          rate: a.rate ? `₹${a.rate.toLocaleString("en-IN")}/-` : "",
          amount: a.rate || 0,
        });
      });

      acceptedHires.forEach((h) => {
        records.push({
          id: String(h._id),
          title: h.title || "Match",
          event: h.role || "",
          org: h.fromName || "",
          location: h.location || "",
          time: "",
          date: h.eventDate || "",
          rate: h.offerPayment ? (/[₹]/.test(h.offerPayment) ? h.offerPayment : `₹${h.offerPayment}`) : "",
          amount: toAmount(h.offerPayment),
        });
      });

      const jobs = classifyEngagements(records);

      // Stats derived from completed engagements + profile ratings
      const now = new Date();
      let totalEarnings = 0;
      let thisMonth = 0;
      const completedRecords = records.filter((r) => {
        const dt = parseDate(r.date);
        return dt && dt < new Date(now.getFullYear(), now.getMonth(), now.getDate());
      });
      completedRecords.forEach((r) => {
        totalEarnings += r.amount || 0;
        const dt = parseDate(r.date);
        if (dt && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()) {
          thisMonth += r.amount || 0;
        }
      });

      const rated = profiles.filter((p) => p.rating > 0);
      const rating = rated.length
        ? (rated.reduce((s, p) => s + p.rating, 0) / rated.length).toFixed(1)
        : "0.0";
      const reviewCount = profiles.reduce((s, p) => s + (p.reviewCount || 0), 0);

      const fmt = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
      const stats = {
        totalEarnings: fmt(totalEarnings),
        thisMonth: fmt(thisMonth),
        rating: String(rating),
        reviewCount,
        totalJobs: jobs.completed.length,
      };

      res.json({ success: true, stats, jobs });
    } catch (err) {
      console.error("[JOBS] getDashboard:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = jobsController;
