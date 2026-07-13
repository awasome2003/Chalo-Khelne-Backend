/**
 * Club OS cross-module automation — audit trail + finance auto-posting.
 * Mirrors the prototype where a booking/rental/fee auto-writes an audit entry
 * and a matching finance transaction. All helpers are best-effort (never throw
 * into the caller's request path).
 */
const ClubAudit = require("./models/ClubAudit");
const ClubFinance = require("./models/ClubFinance");
const ClubCustomer = require("./models/ClubCustomer");

const GST_RATE = 0.18; // default 18% (Settings module will make this configurable)

// Append an audit-trail entry. Fire-and-forget.
async function logClubAudit(clubId, { user = "Admin", action, module = "", details = "" }) {
  try { await ClubAudit.create({ clubId, user, action, module, details }); }
  catch (e) { console.error("[CLUB_AUDIT]", e.message); }
}

// Post an income/expense line. Computes GST for income, a reference id, and
// links the automation source. Returns the created doc (or null on failure).
async function postClubFinance(clubId, { type, category, amount, description = "", paymentMethod = "UPI", sourceType = "", sourceId = null, createdBy = null, withGst = true }) {
  try {
    const amt = Number(amount) || 0;
    const gstAmount = withGst && type === "Income" ? Math.round(amt * GST_RATE * 100) / 100 : 0;
    const prefix = type === "Income" ? "TXN" : "REF";
    const referenceId = `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
    return await ClubFinance.create({ clubId, type, category, amount: amt, gstAmount, paymentMethod, referenceId, description, sourceType, sourceId, createdBy });
  } catch (e) { console.error("[CLUB_FINANCE_AUTO]", e.message); return null; }
}

/**
 * Upsert a CRM customer profile from a booking/membership and append a timeline
 * event. Keyed by phone within a club (walk-ins with no phone get a fresh
 * profile). Best-effort — never throws into the caller. Returns the customer.
 */
async function upsertClubCustomer(clubId, {
  name, phone = "", email = "", sport = "", spent = 0,
  membershipStatus, incBookings = 0, incVisits = 1, event = null,
}) {
  try {
    if (!name) return null;
    const today = new Date().toISOString().slice(0, 10);
    const query = phone ? { clubId, phone } : { clubId, name, phone: "" };
    let customer = await ClubCustomer.findOne(query);
    if (!customer) {
      customer = new ClubCustomer({ clubId, name, phone, email, favoriteSports: sport ? [sport] : [] });
    }
    if (email && !customer.email) customer.email = email;
    if (sport && !customer.favoriteSports.includes(sport)) customer.favoriteSports.push(sport);
    if (membershipStatus) customer.membershipStatus = membershipStatus;
    customer.lifetimeSpending += Number(spent) || 0;
    customer.totalVisits += Number(incVisits) || 0;
    customer.totalBookings += Number(incBookings) || 0;
    customer.lastVisit = today;
    if (event) {
      customer.timeline.unshift({
        type: event.type || "booking",
        date: event.date || today,
        time: event.time || "",
        title: event.title || "",
        description: event.description || "",
      });
    }
    await customer.save();
    return customer;
  } catch (e) { console.error("[CLUB_CRM_UPSERT]", e.message); return null; }
}

module.exports = { logClubAudit, postClubFinance, upsertClubCustomer, GST_RATE };
