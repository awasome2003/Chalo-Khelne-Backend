/**
 * Club Settings controller (Club OS). One config doc per club (clubId-unique).
 * GET returns the saved config (prefilled from the club account on first load);
 * PUT upserts it.
 */
const ClubSetting = require("../src/modules/club/models/ClubSetting");
const User = require("../src/modules/identity/models/User");
const { resolveClubId } = require("../src/modules/club/scope");
const { logClubAudit } = require("../src/modules/club/automation");

const FIELDS = ["name", "address", "phone", "email", "operatingHoursStart", "operatingHoursEnd", "sportsSupported", "bookingWindowDays", "cancellationPolicyHours", "taxRatePercent", "currency", "primaryColor"];

exports.get = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    let settings = await ClubSetting.findOne({ clubId }).lean();
    if (!settings) {
      // No saved config yet — seed sensible defaults from the club account.
      const user = await User.findById(clubId).select("clubName email mobile").lean();
      settings = {
        clubId, name: user?.clubName || "", email: user?.email || "", phone: user?.mobile || "",
        address: "", operatingHoursStart: "06:00", operatingHoursEnd: "22:00", sportsSupported: [],
        bookingWindowDays: 7, cancellationPolicyHours: 12, taxRatePercent: 18, currency: "₹", primaryColor: "emerald",
      };
    }
    return res.json({ success: true, settings });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const clubId = await resolveClubId(req);
    if (!clubId) return res.status(403).json({ success: false, message: "No club context" });
    const update = {};
    for (const k of FIELDS) if (req.body[k] !== undefined) update[k] = req.body[k];
    const settings = await ClubSetting.findOneAndUpdate(
      { clubId }, { $set: update, $setOnInsert: { clubId } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await logClubAudit(clubId, { action: "Save Settings", module: "Settings", details: "Saved club configuration" });
    return res.json({ success: true, settings });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
