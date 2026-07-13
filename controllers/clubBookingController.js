/**
 * Club Bookings controller (Club OS). Tenant-scoped by clubId.
 * Cross-module automation (from the prototype):
 *   - create a PAID booking  → auto-post ClubFinance income + audit
 *   - cancel/refund a PAID booking → auto-post ClubFinance refund expense + audit
 *   - mark an unpaid booking paid → auto-post income + audit
 */
const ClubBooking = require("../src/modules/club/models/ClubBooking");
const ClubCourt = require("../src/modules/club/models/ClubCourt");
const { resolveClubId } = require("../src/modules/club/scope");
const { postClubFinance, logClubAudit, upsertClubCustomer } = require("../src/modules/club/automation");

const FIELDS = ["courtId", "courtName", "sport", "customerName", "customerPhone", "date", "startTime", "duration", "source", "isPaid", "amount", "coachId", "coachName", "notes", "isRecurring", "recurrenceRule"];

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const q = { clubId };
    if (req.query.date) q.date = req.query.date;
    if (req.query.sport && req.query.sport !== "All") q.sport = req.query.sport;
    const bookings = await ClubBooking.find(q).sort({ date: 1, startTime: 1 }).lean();
    return res.json({ success: true, count: bookings.length, bookings });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.customerName || !String(req.body.customerName).trim()) return res.status(400).json({ success: false, message: "Customer name is required" });
    if (!req.body.date) return res.status(400).json({ success: false, message: "Date is required" });

    const payload = { clubId, createdBy: req.user?.id || null };
    for (const k of FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    // Derive amount from the court's rate × duration when not provided.
    if (payload.amount === undefined && payload.courtId) {
      const court = await ClubCourt.findOne({ _id: payload.courtId, clubId }).lean();
      if (court) { payload.amount = (Number(court.pricePerHour) || 0) * (Number(payload.duration) || 1); payload.courtName = payload.courtName || court.name; payload.sport = payload.sport || court.sport; }
    }
    const booking = await ClubBooking.create(payload);

    await logClubAudit(clubId, { action: "Create Booking", module: "Bookings", details: `Booked ${booking.courtName || "court"} for ${booking.customerName}` });
    if (booking.isPaid && booking.amount > 0) {
      await postClubFinance(clubId, { type: "Income", category: "Court Booking", amount: booking.amount, description: `${booking.customerName} — ${booking.courtName} booking`, sourceType: "booking", sourceId: booking._id, createdBy: req.user?.id || null });
    }
    // CRM: upsert the customer profile + append a booking timeline event.
    await upsertClubCustomer(clubId, {
      name: booking.customerName, phone: booking.customerPhone, sport: booking.sport,
      spent: booking.isPaid ? booking.amount : 0, incBookings: 1,
      event: { type: "booking", date: booking.date, time: booking.startTime, title: `${booking.courtName || "Court"} reservation`, description: `Booked ${booking.sport || "session"} for ${booking.duration || 1}h` },
    });
    return res.status(201).json({ success: true, booking });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const booking = await ClubBooking.findOneAndUpdate({ _id: req.params.bookingId, clubId }, update, { new: true, runValidators: true });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    await logClubAudit(clubId, { action: "Update Booking", module: "Bookings", details: `Modified booking for ${booking.customerName}` });
    return res.json({ success: true, booking });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Mark an unpaid booking as paid → auto-post income.
exports.markPaid = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const booking = await ClubBooking.findOne({ _id: req.params.bookingId, clubId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.isPaid) return res.json({ success: true, booking });
    if (req.body.paymentMethod) booking.paymentMethod = req.body.paymentMethod;
    booking.isPaid = true;
    await booking.save();
    if (booking.amount > 0) {
      await postClubFinance(clubId, { type: "Income", category: "Court Booking", amount: booking.amount, paymentMethod: req.body.paymentMethod || "UPI", description: `Settlement: ${booking.customerName} — ${booking.courtName}`, sourceType: "booking", sourceId: booking._id, createdBy: req.user?.id || null });
    }
    await logClubAudit(clubId, { action: "Collect Payment", module: "Bookings", details: `Settled booking for ${booking.customerName} (${booking.amount})` });
    return res.json({ success: true, booking });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Cancel a booking → if it was paid, auto-post a refund expense.
exports.cancel = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const booking = await ClubBooking.findOne({ _id: req.params.bookingId, clubId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    const wasPaid = booking.isPaid;
    booking.status = "Cancelled";
    await booking.save();
    await logClubAudit(clubId, { action: "Cancel Booking", module: "Bookings", details: `Canceled booking for ${booking.customerName}` });
    if (wasPaid && booking.amount > 0) {
      await postClubFinance(clubId, { type: "Expense", category: "Refund", amount: booking.amount, description: `Refund: canceled ${booking.courtName} booking for ${booking.customerName}`, sourceType: "booking", sourceId: booking._id, createdBy: req.user?.id || null, withGst: false });
    }
    return res.json({ success: true, booking });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Refund a paid booking (keeps the slot) → mark unpaid + refund expense.
exports.refund = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const booking = await ClubBooking.findOne({ _id: req.params.bookingId, clubId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (!booking.isPaid) return res.status(400).json({ success: false, message: "Booking is not paid" });
    booking.isPaid = false;
    await booking.save();
    await postClubFinance(clubId, { type: "Expense", category: "Refund", amount: booking.amount, description: `Refund: ${booking.courtName} booking for ${booking.customerName}`, sourceType: "booking", sourceId: booking._id, createdBy: req.user?.id || null, withGst: false });
    await logClubAudit(clubId, { action: "Refund Booking", module: "Bookings", details: `Refunded ${booking.amount} for ${booking.customerName}` });
    return res.json({ success: true, booking });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const booking = await ClubBooking.findOneAndDelete({ _id: req.params.bookingId, clubId });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    await logClubAudit(clubId, { action: "Delete Booking", module: "Bookings", details: `Deleted booking for ${booking.customerName}` });
    return res.json({ success: true, message: "Booking removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
