/**
 * Club Members & Packages controller (Club OS). Tenant-scoped by clubId.
 * Membership purchases (enroll/renew/upgrade) auto-post ClubFinance income;
 * refunds post a refund expense. Every action writes a ClubAudit entry.
 */
const ClubMember = require("../src/modules/club/models/ClubMember");
const MembershipPackage = require("../src/modules/club/models/MembershipPackage");
const { resolveClubId } = require("../src/modules/club/scope");
const { postClubFinance, logClubAudit, upsertClubCustomer } = require("../src/modules/club/automation");

const today = () => new Date().toISOString().slice(0, 10);
const PKG_FIELDS = ["name", "price", "validity", "sports", "bookingLimit", "guestAccess", "benefits", "isActive"];
const MEMBER_FIELDS = ["name", "phone", "email", "gender", "dob", "sports", "emergencyContact"];

// ───────────────────────── Packages ─────────────────────────
exports.listPackages = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const packages = await MembershipPackage.find({ clubId }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, count: packages.length, packages });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.createPackage = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Package name is required" });
    const payload = { clubId, createdBy: req.user?.id || null };
    for (const k of PKG_FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const pkg = await MembershipPackage.create(payload);
    await logClubAudit(clubId, { action: "Configure Package", module: "Members", details: `Saved membership package: ${pkg.name}` });
    return res.status(201).json({ success: true, package: pkg });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.updatePackage = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const update = {};
    for (const k of PKG_FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const pkg = await MembershipPackage.findOneAndUpdate({ _id: req.params.packageId, clubId }, update, { new: true, runValidators: true });
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    return res.json({ success: true, package: pkg });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.deletePackage = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const pkg = await MembershipPackage.findOneAndDelete({ _id: req.params.packageId, clubId });
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    return res.json({ success: true, message: "Package removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// ───────────────────────── Members ─────────────────────────
exports.listMembers = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const members = await ClubMember.find({ clubId }).sort({ createdAt: -1 }).lean();
    const stats = {
      total: members.length,
      active: members.filter((m) => m.status === "Active").length,
      expired: members.filter((m) => m.status === "Expired").length,
      pending: members.filter((m) => m.status === "Pending").length,
      blocked: members.filter((m) => m.status === "Blocked").length,
    };
    return res.json({ success: true, count: members.length, members, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

const loadPackage = async (clubId, packageId) => packageId ? MembershipPackage.findOne({ _id: packageId, clubId }).lean() : null;

// Enroll a member → subscribe to a package + auto-post the plan fee as income.
exports.createMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ success: false, message: "Member name is required" });

    const pkg = await loadPackage(clubId, req.body.packageId);
    const fee = pkg ? Number(pkg.price) || 0 : 0;
    const payload = { clubId, createdBy: req.user?.id || null, status: "Active", joiningDate: today(), lifetimeSpending: fee, packageId: pkg?._id || null, packageName: pkg?.name || "" };
    for (const k of MEMBER_FIELDS) if (req.body[k] !== undefined) payload[k] = req.body[k];
    const member = await ClubMember.create(payload);

    await logClubAudit(clubId, { action: "Register Member", module: "Members", details: `Enrolled ${member.name}${pkg ? ` in ${pkg.name}` : ""}` });
    if (fee > 0) await postClubFinance(clubId, { type: "Income", category: "Membership", amount: fee, description: `Membership: ${member.name} — ${pkg.name}`, sourceType: "member", sourceId: member._id, createdBy: req.user?.id || null });
    // CRM: upsert the customer profile as an active member + timeline event.
    await upsertClubCustomer(clubId, {
      name: member.name, phone: member.phone, email: member.email,
      sport: (member.sports || [])[0] || "", spent: fee, membershipStatus: "Active", incVisits: 1,
      event: { type: "membership_purchased", title: "Membership enrolled", description: pkg ? `Subscribed to ${pkg.name}` : "Enrolled as member" },
    });
    return res.status(201).json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.renewMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOne({ _id: req.params.memberId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    const pkg = await loadPackage(clubId, member.packageId);
    const fee = pkg ? Number(pkg.price) || 0 : 0;
    member.status = "Active"; member.joiningDate = today(); member.lifetimeSpending += fee;
    await member.save();
    await logClubAudit(clubId, { action: "Renew Membership", module: "Members", details: `Renewed ${member.name}` });
    if (fee > 0) await postClubFinance(clubId, { type: "Income", category: "Membership", amount: fee, description: `Renewal: ${member.name} — ${pkg.name}`, sourceType: "member", sourceId: member._id, createdBy: req.user?.id || null });
    return res.json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.expireMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOneAndUpdate({ _id: req.params.memberId, clubId }, { status: "Expired" }, { new: true });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    await logClubAudit(clubId, { action: "Expire Plan", module: "Members", details: `Expired plan for ${member.name}` });
    return res.json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Upgrade/change plan → charge a custom amount as income.
exports.upgradeMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOne({ _id: req.params.memberId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    const pkg = await loadPackage(clubId, req.body.packageId);
    if (!pkg) return res.status(400).json({ success: false, message: "Target package not found" });
    const amount = Number(req.body.customAmount);
    const charge = Number.isFinite(amount) && amount >= 0 ? amount : (Number(pkg.price) || 0);
    member.packageId = pkg._id; member.packageName = pkg.name; member.status = "Active"; member.joiningDate = today(); member.lifetimeSpending += charge;
    await member.save();
    await logClubAudit(clubId, { action: "Upgrade Plan", module: "Members", details: `Upgraded ${member.name} to ${pkg.name}` });
    if (charge > 0) await postClubFinance(clubId, { type: "Income", category: "Membership", amount: charge, description: `Plan change: ${member.name} → ${pkg.name}`, sourceType: "member", sourceId: member._id, createdBy: req.user?.id || null });
    return res.json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

// Refund a member → expire + post a refund expense.
exports.refundMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOne({ _id: req.params.memberId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    const amount = Number(req.body.amount) || 0;
    member.status = "Expired"; member.lifetimeSpending = Math.max(0, member.lifetimeSpending - amount);
    await member.save();
    await logClubAudit(clubId, { action: "Refund Membership", module: "Members", details: `Refunded ${amount} for ${member.name}` });
    if (amount > 0) await postClubFinance(clubId, { type: "Expense", category: "Refund", amount, description: `Membership refund: ${member.name}`, sourceType: "member", sourceId: member._id, createdBy: req.user?.id || null, withGst: false });
    return res.json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.toggleBlockMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOne({ _id: req.params.memberId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    const wasBlocked = member.status === "Blocked";
    member.status = wasBlocked ? "Active" : "Blocked";
    await member.save();
    await logClubAudit(clubId, { action: wasBlocked ? "Unblock Member" : "Block Member", module: "Members", details: `${wasBlocked ? "Activated" : "Suspended"} ${member.name}` });
    return res.json({ success: true, member });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.removeMember = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const member = await ClubMember.findOneAndDelete({ _id: req.params.memberId, clubId });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    await logClubAudit(clubId, { action: "Remove Member", module: "Members", details: `Removed ${member.name}` });
    return res.json({ success: true, message: "Member removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
