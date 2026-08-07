/**
 * Club Communication / Broadcasts controller (Club OS). Tenant-scoped by clubId.
 * Composes a broadcast, resolves the audience size from the relevant collection,
 * and logs it. External dispatch (WhatsApp/SMS/Email/Push) is a provider
 * integration point — recorded as "Queued" here.
 */
const ClubBroadcast = require("../src/modules/club/models/ClubBroadcast");
const ClubMember = require("../src/modules/club/models/ClubMember");
const ClubCoach = require("../src/modules/club/models/ClubCoach");
const ClubStaff = require("../src/modules/club/models/ClubStaff");
const ClubCustomer = require("../src/modules/club/models/ClubCustomer");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

async function audienceSize(clubId, audience) {
  switch (audience) {
    case "Members": return ClubMember.countDocuments({ clubId });
    case "Coaches": return ClubCoach.countDocuments({ clubId });
    case "Staff": return ClubStaff.countDocuments({ clubId });
    case "Tournament Players": return ClubCustomer.countDocuments({ clubId });
    default: return 0;
  }
}

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const broadcasts = await ClubBroadcast.find({ clubId }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ success: true, count: broadcasts.length, broadcasts });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const { channel, audience, subject, text } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ success: false, message: "Message body is required" });
    if (channel === "Email" && !String(subject || "").trim()) return res.status(400).json({ success: false, message: "Email subject is required" });

    const recipientCount = await audienceSize(clubId, audience || "Members");
    const broadcast = await ClubBroadcast.create({
      clubId, channel: channel || "WhatsApp", audience: audience || "Members",
      subject: subject || "", text: String(text).trim(), recipientCount,
      status: "Queued", createdBy: req.user?.id || null,
    });
    await logClubAudit(clubId, { action: "Send Broadcast", module: "Communication", details: `${channel || "WhatsApp"} to ${recipientCount} ${audience || "Members"}` });
    return res.status(201).json({ success: true, broadcast });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const b = await ClubBroadcast.findOneAndDelete({ _id: req.params.broadcastId, clubId });
    if (!b) return res.status(404).json({ success: false, message: "Broadcast not found" });
    return res.json({ success: true, message: "Broadcast removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
