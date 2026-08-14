"use strict";
/**
 * Tournament-day attendance / check-in.
 *
 * Solves the problem that 53 register and 16–25 turn up: the draw must be built
 * from who is PRESENT. See models/TournamentAttendance.js for the data-model
 * rationale.
 *
 * Design rules enforced here:
 *   • Presence is independent of payment. An unpaid player standing at the desk
 *     can be checked in and drawn; their payment status travels with the roster
 *     row so it can be collected, but it never gates anything.
 *   • Attendance is per (sport, category) ENTRY, not per person — one
 *     registration can enter MS + MD + XD and turn up for only some.
 *   • A player may only ever check THEMSELVES in, and only as present. Marking
 *     someone absent is a manager decision.
 */

const mongoose = require("mongoose");
const TournamentAttendance = require("../src/modules/tournaments/models/TournamentAttendance");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Tournament = require("../src/modules/tournaments/models/Tournament");

const VALID_STATUSES = ["checked_in", "no_show", "withdrawn"];

function callerId(req) {
  return req.user?._id || req.user?.id || req.user?.userId || null;
}

/**
 * Expand bookings into one roster row per (sport, category) entry, then merge
 * in any attendance decision that has been made.
 *
 * A booking with three sportSelections produces three rows: that is the grain
 * the draw actually consumes.
 */
function buildRoster(bookings, attendanceRows, { sportId, categoryName } = {}) {
  const byKey = new Map();
  for (const a of attendanceRows) {
    byKey.set(`${a.bookingId}|${a.sportId}|${a.categoryName}`, a);
  }

  const roster = [];
  for (const b of bookings) {
    const selections = Array.isArray(b.sportSelections) ? b.sportSelections : [];
    for (const sel of selections) {
      if (sportId && String(sel.sportId) !== String(sportId)) continue;
      if (categoryName && sel.categoryName !== categoryName) continue;

      const key = `${b._id}|${sel.sportId}|${sel.categoryName}`;
      const marked = byKey.get(key);

      roster.push({
        bookingId: b._id,
        userId: b.userId || null,
        userName: b.userName || "Player",
        userPhone: b.userPhone || null,
        isGuestBooking: !b.userId,

        sportId: sel.sportId,
        sportName: sel.sportName || null,
        categoryName: sel.categoryName,
        seed: b.seed ?? null,

        // Surfaced, never enforced. The desk needs to know who still owes money
        // — it does not need the system to refuse them.
        paymentStatus: b.paymentStatus || "pending",
        bookingStatus: b.status || "pending",
        feeOwed: b.paymentAmount ?? b.totalFee ?? 0,

        // No row means "registered, not yet marked" — deliberately distinct
        // from an explicit no_show.
        attendanceStatus: marked ? marked.status : "registered",
        markedVia: marked ? marked.markedVia : null,
        markedAt: marked ? marked.markedAt : null,
      });
    }
  }

  // Seeded players first (1 = top seed), then everyone else by name so the desk
  // list is scannable.
  roster.sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return String(a.userName).localeCompare(String(b.userName));
  });

  return roster;
}

function summarise(roster) {
  const s = { total: roster.length, checkedIn: 0, noShow: 0, withdrawn: 0, unmarked: 0, unpaidPresent: 0 };
  for (const r of roster) {
    if (r.attendanceStatus === "checked_in") {
      s.checkedIn++;
      if (r.paymentStatus !== "paid" && r.paymentStatus !== "waived") s.unpaidPresent++;
    } else if (r.attendanceStatus === "no_show") s.noShow++;
    else if (r.attendanceStatus === "withdrawn") s.withdrawn++;
    else s.unmarked++;
  }
  return s;
}

async function loadRoster(tournamentId, { sportId, categoryName } = {}) {
  const [bookings, attendance] = await Promise.all([
    Booking.find({ tournamentId })
      .select("userId userName userPhone status paymentStatus paymentAmount totalFee sportSelections seed")
      .lean(),
    TournamentAttendance.find({ tournamentId }).lean(),
  ]);
  return buildRoster(bookings, attendance, { sportId, categoryName });
}

// ── GET /api/tournaments/:tournamentId/attendance ───────────────────────────
// The tournament-day roster. Optional ?sportId= and ?categoryName= narrow it to
// the entry list the desk is currently working through.
exports.getRoster = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }

    const roster = await loadRoster(tournamentId, {
      sportId: req.query.sportId,
      categoryName: req.query.categoryName,
    });

    res.json({
      success: true,
      data: roster,
      summary: summarise(roster),
    });
  } catch (err) {
    console.error("[ATTENDANCE] getRoster:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── GET /api/tournaments/:tournamentId/attendance/summary ───────────────────
// Counts only — cheap enough for the draw screens to poll for their toggle
// label ("Checked-in (24)" vs "All registered (53)").
exports.getSummary = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }
    const roster = await loadRoster(tournamentId, {
      sportId: req.query.sportId,
      categoryName: req.query.categoryName,
    });
    res.json({ success: true, summary: summarise(roster) });
  } catch (err) {
    console.error("[ATTENDANCE] getSummary:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * Upsert one attendance decision. Shared by every marking path.
 * Re-marking updates in place, so present→absent→present leaves ONE row.
 */
async function upsertMark({ tournamentId, entry, status, markedVia, markedBy, note }) {
  const booking = await Booking.findOne({ _id: entry.bookingId, tournamentId })
    .select("userId userName sportSelections")
    .lean();
  if (!booking) return { ok: false, reason: "booking_not_found" };

  const selections = Array.isArray(booking.sportSelections) ? booking.sportSelections : [];
  const sel = selections.find(
    (s) =>
      String(s.sportId) === String(entry.sportId) &&
      s.categoryName === entry.categoryName
  );
  if (!sel) return { ok: false, reason: "entry_not_in_booking" };

  const doc = await TournamentAttendance.findOneAndUpdate(
    {
      tournamentId,
      sportId: entry.sportId,
      categoryName: entry.categoryName,
      bookingId: entry.bookingId,
    },
    {
      $set: {
        userId: booking.userId || null,
        userName: booking.userName || "Player",
        status,
        markedVia,
        markedBy: markedBy || null,
        markedAt: new Date(),
        note: note || null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { ok: true, doc };
}

// ── POST /api/tournaments/:tournamentId/attendance/mark ─────────────────────
// Manager marks one entry present/absent/withdrawn.
exports.markAttendance = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { bookingId, sportId, categoryName, status, note } = req.body;

    if (!mongoose.isValidObjectId(tournamentId) || !mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId or bookingId" });
    }
    if (!sportId || !categoryName) {
      return res.status(400).json({ success: false, message: "sportId and categoryName are required" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const result = await upsertMark({
      tournamentId,
      entry: { bookingId, sportId, categoryName },
      status,
      markedVia: "manager_web",
      markedBy: callerId(req),
      note,
    });

    if (!result.ok) {
      return res.status(404).json({
        success: false,
        message:
          result.reason === "booking_not_found"
            ? "Registration not found for this tournament"
            : "That sport/category is not part of this registration",
      });
    }

    res.json({ success: true, data: result.doc });
  } catch (err) {
    console.error("[ATTENDANCE] markAttendance:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── POST /api/tournaments/:tournamentId/attendance/bulk ─────────────────────
// Mark many at once.
//
// Accepts either explicit entries, or a pasted list of NAMES (`names: [...]`)
// for the very common case where attendance was taken on paper first. Name
// matching is case/whitespace-insensitive and reports what it could not match
// rather than silently dropping it.
exports.bulkMarkAttendance = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { entries, names, sportId, categoryName, status, markedVia } = req.body;

    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    let targets = [];
    const unmatched = [];

    if (Array.isArray(entries) && entries.length > 0) {
      targets = entries;
    } else if (Array.isArray(names) && names.length > 0) {
      if (!sportId || !categoryName) {
        return res.status(400).json({
          success: false,
          message: "sportId and categoryName are required when marking by name",
        });
      }
      const roster = await loadRoster(tournamentId, { sportId, categoryName });
      const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      const byName = new Map();
      for (const r of roster) {
        // Last one wins on a duplicate name; the ambiguity is reported below.
        const k = norm(r.userName);
        if (byName.has(k)) byName.set(k, { ...byName.get(k), ambiguous: true });
        else byName.set(k, r);
      }
      for (const raw of names) {
        const hit = byName.get(norm(raw));
        if (!hit) {
          unmatched.push({ name: raw, reason: "no_match" });
        } else if (hit.ambiguous) {
          unmatched.push({ name: raw, reason: "ambiguous_duplicate_name" });
        } else {
          targets.push({
            bookingId: hit.bookingId,
            sportId: hit.sportId,
            categoryName: hit.categoryName,
          });
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide either entries[] or names[]",
      });
    }

    const results = { marked: 0, failed: [] };
    for (const entry of targets) {
      const r = await upsertMark({
        tournamentId,
        entry,
        status,
        markedVia: markedVia === "bulk_import" ? "bulk_import" : "bulk_import",
        markedBy: callerId(req),
      });
      if (r.ok) results.marked++;
      else results.failed.push({ ...entry, reason: r.reason });
    }

    res.json({ success: true, ...results, unmatched });
  } catch (err) {
    console.error("[ATTENDANCE] bulkMarkAttendance:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── POST /api/tournaments/:tournamentId/attendance/mark-remaining ───────────
// "Everyone I haven't ticked didn't show." The single most useful action at the
// moment the desk closes: it turns an unmarked roster into a decided one.
exports.markRemaining = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sportId, categoryName, status } = req.body;

    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }
    const target = status || "no_show";
    if (!VALID_STATUSES.includes(target)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const roster = await loadRoster(tournamentId, { sportId, categoryName });
    const unmarked = roster.filter((r) => r.attendanceStatus === "registered");

    let marked = 0;
    for (const r of unmarked) {
      const res2 = await upsertMark({
        tournamentId,
        entry: { bookingId: r.bookingId, sportId: r.sportId, categoryName: r.categoryName },
        status: target,
        markedVia: "manager_web",
        markedBy: callerId(req),
      });
      if (res2.ok) marked++;
    }

    res.json({ success: true, marked, status: target });
  } catch (err) {
    console.error("[ATTENDANCE] markRemaining:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── POST /api/tournaments/:tournamentId/attendance/self ─────────────────────
// Player checks THEMSELVES in from the mobile app.
//
// Two hard rules, both enforced here rather than trusted to the client:
//   • the booking must belong to the caller — you cannot check anyone else in;
//   • the only status a player can set is "checked_in". Marking someone absent
//     (or withdrawing them) stays a manager decision, because it removes them
//     from the draw.
exports.selfCheckIn = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sportId, categoryName } = req.body;
    const userId = callerId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }

    const booking = await Booking.findOne({ tournamentId, userId })
      .select("_id sportSelections userName")
      .lean();
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "You are not registered for this tournament",
      });
    }

    const tournament = await Tournament.findById(tournamentId).select("title endDate").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    // Entries to check into: the specific one asked for, or all of the
    // player's entries when none is named.
    const selections = Array.isArray(booking.sportSelections) ? booking.sportSelections : [];
    const targets = selections.filter((s) => {
      if (sportId && String(s.sportId) !== String(sportId)) return false;
      if (categoryName && s.categoryName !== categoryName) return false;
      return true;
    });

    if (targets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No matching entry found on your registration",
      });
    }

    const checkedIn = [];
    for (const sel of targets) {
      const r = await upsertMark({
        tournamentId,
        entry: {
          bookingId: booking._id,
          sportId: sel.sportId,
          categoryName: sel.categoryName,
        },
        status: "checked_in", // players can ONLY mark themselves present
        markedVia: "player_mobile",
        markedBy: null, // the player is the actor; userId records who
      });
      if (r.ok) checkedIn.push({ sportId: sel.sportId, categoryName: sel.categoryName });
    }

    res.json({
      success: true,
      message: `You're checked in for ${tournament.title}`,
      checkedIn,
    });
  } catch (err) {
    console.error("[ATTENDANCE] selfCheckIn:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── GET /api/tournaments/:tournamentId/attendance/me ────────────────────────
// The mobile screen's "am I checked in?" read.
exports.getMyAttendance = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const userId = callerId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const booking = await Booking.findOne({ tournamentId, userId })
      .select("_id sportSelections")
      .lean();
    if (!booking) {
      return res.json({ success: true, registered: false, entries: [] });
    }

    const rows = await TournamentAttendance.find({
      tournamentId,
      bookingId: booking._id,
    }).lean();
    const byKey = new Map(rows.map((r) => [`${r.sportId}|${r.categoryName}`, r]));

    const entries = (booking.sportSelections || []).map((s) => {
      const hit = byKey.get(`${s.sportId}|${s.categoryName}`);
      return {
        sportId: s.sportId,
        sportName: s.sportName,
        categoryName: s.categoryName,
        attendanceStatus: hit ? hit.status : "registered",
        markedAt: hit ? hit.markedAt : null,
      };
    });

    res.json({ success: true, registered: true, entries });
  } catch (err) {
    console.error("[ATTENDANCE] getMyAttendance:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── POST /api/tournaments/:tournamentId/attendance/walk-in ──────────────────
// Someone turned up who never registered.
//
// Creates the registration AND marks them present in one action, because at the
// desk those are the same event. Previously this needed a full bulk-upload or a
// trip through the whole registration flow.
//
// The player is created as a GUEST booking (userId null) with the fee owed
// recorded but unpaid — presence does not wait for money. The roster row shows
// them as unpaid so the desk can collect.
exports.registerWalkIn = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { name, phone, sportId, categoryName, seed, markPaid } = req.body;

    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ success: false, message: "Invalid tournamentId" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Player name is required" });
    }
    if (!sportId || !categoryName) {
      return res.status(400).json({ success: false, message: "sportId and categoryName are required" });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    // Fee is derived from the tournament, never accepted from the request —
    // same rule as createBooking (§2.4).
    const { findCategory } = require("../utils/eligibility");
    const category = findCategory(tournament, sportId, categoryName);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: "That sport/category does not exist in this tournament",
      });
    }

    const track = (tournament.sports || []).find(
      (s) => String(s.sportId) === String(sportId)
    );
    const fee = Number(category.fee ?? 0);
    const playerName = String(name).trim();

    // Don't silently create a second registration for someone already entered.
    const existing = await Booking.findOne({
      tournamentId,
      userName: new RegExp(`^${playerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).select("_id userName sportSelections").lean();

    let bookingId;
    if (existing) {
      const already = (existing.sportSelections || []).some(
        (s) => String(s.sportId) === String(sportId) && s.categoryName === categoryName
      );
      if (already) {
        // Already registered for this entry — just check them in.
        bookingId = existing._id;
      } else {
        // Registered for the tournament but not this entry: add the entry.
        await Booking.updateOne(
          { _id: existing._id },
          {
            $push: {
              sportSelections: {
                sportId,
                sportName: track?.sportName || null,
                categoryName,
                fee,
              },
            },
            $inc: { totalFee: fee, paymentAmount: markPaid ? 0 : fee },
          }
        );
        bookingId = existing._id;
      }
    } else {
      const booking = await Booking.create({
        userId: null, // guest — no account needed to play
        userName: playerName,
        userPhone: phone ? String(phone).trim() : null,
        isGuestBooking: true,
        tournamentId,
        tournamentName: tournament.title,
        tournamentType: tournament.type || "knockout",
        status: "confirmed", // they are here and playing
        paymentStatus: markPaid ? "paid" : "pending",
        paymentMethod: "cash",
        paymentAmount: fee,
        totalFee: fee,
        seed: Number.isFinite(Number(seed)) ? Number(seed) : null,
        sportSelections: [
          {
            sportId,
            sportName: track?.sportName || null,
            categoryName,
            fee,
          },
        ],
      });
      bookingId = booking._id;
    }

    const marked = await upsertMark({
      tournamentId,
      entry: { bookingId, sportId, categoryName },
      status: "checked_in",
      markedVia: "walk_in",
      markedBy: callerId(req),
    });

    if (!marked.ok) {
      return res.status(500).json({
        success: false,
        message: "Registration created but check-in failed",
        reason: marked.reason,
      });
    }

    res.status(201).json({
      success: true,
      message: `${playerName} registered and checked in`,
      bookingId,
      feeOwed: markPaid ? 0 : fee,
      data: marked.doc,
    });
  } catch (err) {
    console.error("[ATTENDANCE] registerWalkIn:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Exported for the draw controllers and tests.
exports._internal = { buildRoster, summarise, loadRoster, upsertMark };
