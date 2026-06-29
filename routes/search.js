const express = require("express");
const router = express.Router();
const { allowUserOrManager } = require("../middleware/authMiddleware");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const Turf = require("../src/modules/org/models/Turf");
const Trainer = require("../src/modules/org/models/Trainer");
const News = require("../src/modules/social/models/News");
const Coupon = require("../src/modules/commerce/models/Coupon");
const User = require("../src/modules/identity/models/User");

const PER_TYPE_LIMIT = 5;
const ABS_MAX_LIMIT = 10;
const QUERY_MAX_LEN = 80;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fmtDate = (d) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
};

// Drop nullish + non-string-coercible values; coerce strings; join. Defends
// against documents where a field is unexpectedly an object.
const joinMeta = (parts) =>
  parts
    .map((p) => {
      if (p == null) return null;
      if (typeof p === "string") return p.trim();
      if (typeof p === "number" || typeof p === "boolean") return String(p);
      return null;
    })
    .filter(Boolean)
    .join(" · ");

const asString = (v, fallback = "") =>
  typeof v === "string" ? v : v == null ? fallback : String(fallback);

router.get("/", allowUserOrManager, async (req, res) => {
  const raw = String(req.query.q || req.query.query || "").trim().slice(0, QUERY_MAX_LEN);
  if (!raw || raw.length < 1) {
    return res.json({ results: [], query: raw });
  }

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || PER_TYPE_LIMIT, 1),
    ABS_MAX_LIMIT
  );

  const requested = String(req.query.types || "tournament,turf,trainer,news,coupon,player")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const includes = (t) => requested.includes(t);

  const rx = { $regex: escapeRegex(raw), $options: "i" };

  const tasks = [];

  if (includes("tournament")) {
    tasks.push(
      Tournament.find({
        $or: [
          { title: rx },
          { description: rx },
          { organizerName: rx },
          { eventLocation: rx },
          { "sports.sportName": rx },
        ],
      })
        .select("title sports startDate endDate eventLocation tournamentLogo")
        .sort({ startDate: -1 })
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => {
            const venue = Array.isArray(d.eventLocation)
              ? d.eventLocation[0]
              : d.eventLocation;
            return {
              type: "tournament",
              id: String(d._id),
              label: asString(d.title, "Tournament"),
              sublabel: joinMeta([
                d.sports?.[0]?.sportName,
                typeof venue === "string" ? venue : null,
                fmtDate(d.startDate),
              ]),
              route: `/tournaments/${d._id}`,
            };
          })
        )
        .catch(() => [])
    );
  }

  if (includes("turf")) {
    tasks.push(
      Turf.find({
        $or: [
          { name: rx },
          { "address.fullAddress": rx },
          { "address.area": rx },
          { "address.city": rx },
          { "address.pincode": rx },
        ],
      })
        .select("name address")
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => {
            const a = d.address || {};
            const sublabel =
              joinMeta([a.area, a.city]) ||
              (typeof a.fullAddress === "string" ? a.fullAddress : "") ||
              "";
            return {
              type: "turf",
              id: String(d._id),
              label: typeof d.name === "string" ? d.name : "Turf",
              sublabel,
              route: `/turf-details/${d._id}`,
            };
          })
        )
        .catch(() => [])
    );
  }

  if (includes("trainer")) {
    tasks.push(
      Trainer.find({
        $or: [{ firstName: rx }, { lastName: rx }, { sports: rx }, { bio: rx }],
      })
        .select("firstName lastName sports rating reviewCount")
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => {
            const name = [asString(d.firstName), asString(d.lastName)]
              .filter(Boolean)
              .join(" ")
              .trim();
            const sportsText = Array.isArray(d.sports)
              ? d.sports.filter((s) => typeof s === "string").slice(0, 2).join(", ")
              : null;
            const rating = Number(d.rating);
            return {
              type: "trainer",
              id: String(d._id),
              label: name || "Trainer",
              sublabel: joinMeta([
                sportsText,
                rating > 0
                  ? `★ ${rating.toFixed(1)} (${Number(d.reviewCount) || 0})`
                  : null,
              ]),
              route: `/mtrainers?id=${d._id}`,
            };
          })
        )
        .catch(() => [])
    );
  }

  if (includes("news")) {
    tasks.push(
      News.find({
        $or: [{ title: rx }, { content: rx }],
      })
        .select("title type publishDate status")
        .sort({ publishDate: -1 })
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            type: "news",
            id: String(d._id),
            label: asString(d.title, "News"),
            sublabel: joinMeta([
              typeof d.type === "string" ? d.type : null,
              typeof d.status === "string" ? d.status : null,
              fmtDate(d.publishDate),
            ]),
            route: `/mnews?id=${d._id}`,
          }))
        )
        .catch(() => [])
    );
  }

  if (includes("coupon")) {
    tasks.push(
      Coupon.find({
        $or: [{ code: rx }, { description: rx }],
      })
        .select("code description discount discountType validTill isActive")
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            type: "coupon",
            id: String(d._id),
            label: asString(d.code, "Coupon"),
            sublabel: joinMeta([
              typeof d.description === "string" ? d.description : null,
              d.isActive ? "Active" : "Inactive",
              d.validTill ? `valid till ${fmtDate(d.validTill)}` : null,
            ]),
            route: `/mcoupons?id=${d._id}`,
          }))
        )
        .catch(() => [])
    );
  }

  if (includes("player")) {
    tasks.push(
      User.find({
        $or: [{ name: rx }, { email: rx }, { username: rx }],
      })
        .select("name email username role")
        .limit(limit)
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            type: "player",
            id: String(d._id),
            label: asString(d.name) || asString(d.username, "User"),
            sublabel: joinMeta([
              typeof d.email === "string" ? d.email : null,
              typeof d.role === "string" ? d.role : null,
            ]),
            route: null,
          }))
        )
        .catch(() => [])
    );
  }

  try {
    const grouped = await Promise.all(tasks);
    const results = grouped.flat();
    return res.json({ results, query: raw });
  } catch (err) {
    console.error("[search] failed:", err);
    return res
      .status(500)
      .json({ error: "Search failed", details: err.message, results: [] });
  }
});

module.exports = router;
