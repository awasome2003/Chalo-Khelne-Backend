/**
 * Club Reviews controller (Club OS). Tenant-scoped by clubId. Admin records +
 * replies to Club/Coach/Court testimonials.
 */
const ClubReview = require("../src/modules/club/models/ClubReview");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

exports.list = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const reviews = await ClubReview.find({ clubId }).sort({ createdAt: -1 }).lean();
    const total = reviews.length;
    const avg = total ? Math.round((reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / total) * 10) / 10 : 0;
    const byRating = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) if (byRating[r.rating] !== undefined) byRating[r.rating] += 1;
    const stats = { total, average: avg, byRating, replied: reviews.filter((r) => r.reply && r.reply.trim()).length };
    return res.json({ success: true, count: total, reviews, stats });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.create = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    if (!req.body.author || !String(req.body.author).trim()) return res.status(400).json({ success: false, message: "Author is required" });
    const rating = Number(req.body.rating);
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ success: false, message: "Rating must be 1–5" });
    const review = await ClubReview.create({
      clubId, author: String(req.body.author).trim(),
      targetType: req.body.targetType || "Club", targetName: req.body.targetName || "",
      rating, comment: req.body.comment || "", createdBy: req.user?.id || null,
    });
    return res.status(201).json({ success: true, review });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.reply = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const text = String(req.body.reply || "").trim();
    if (!text) return res.status(400).json({ success: false, message: "Reply text is required" });
    const review = await ClubReview.findOneAndUpdate({ _id: req.params.reviewId, clubId }, { reply: text }, { new: true });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    await logClubAudit(clubId, { action: "Reply to Review", module: "Reviews", details: `Responded to ${review.author}'s review` });
    return res.json({ success: true, review });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    const review = await ClubReview.findOneAndDelete({ _id: req.params.reviewId, clubId });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    return res.json({ success: true, message: "Review removed" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
