const CategoryTemplate = require("../src/modules/tournaments/models/CategoryTemplate");
const Tournament = require("../src/modules/tournaments/models/Tournament");

// Starter templates shipped with the system. Re-running the seed is a no-op
// for templates that already exist (matched by code) — it will NOT overwrite
// edits a superadmin made to the seeded rows.
const SEED_TEMPLATES = [
  { label: "Under 10",      code: "U10",   minAge: null, maxAge: 10,   gender: "any",    description: "Players aged 10 or below" },
  { label: "Under 12",      code: "U12",   minAge: null, maxAge: 12,   gender: "any",    description: "Players aged 12 or below" },
  { label: "Under 14",      code: "U14",   minAge: null, maxAge: 14,   gender: "any",    description: "Players aged 14 or below" },
  { label: "Under 17",      code: "U17",   minAge: null, maxAge: 17,   gender: "any",    description: "Players aged 17 or below" },
  { label: "Under 19",      code: "U19",   minAge: null, maxAge: 19,   gender: "any",    description: "Players aged 19 or below" },
  { label: "Under 23",      code: "U23",   minAge: null, maxAge: 23,   gender: "any",    description: "Players aged 23 or below" },
  { label: "Open / Senior", code: "OPEN",  minAge: null, maxAge: null, gender: "any",    description: "No age limit — open to all" },
  { label: "Women's Open",  code: "WOPEN", minAge: null, maxAge: null, gender: "female", description: "No age limit — female players only" },
  { label: "Men's Open",    code: "MOPEN", minAge: null, maxAge: null, gender: "male",   description: "No age limit — male players only" },
  { label: "Veterans 35+",  code: "VET35", minAge: 35,   maxAge: null, gender: "any",    description: "Players aged 35 or above" },
  { label: "Veterans 45+",  code: "VET45", minAge: 45,   maxAge: null, gender: "any",    description: "Players aged 45 or above" },
];

// Smart label parser — suggests min/max/gender from the label text. Hits the
// patterns called out in the spec (U19, Under 19, 19-35, Open, Veterans 35+).
function parseLabelSuggestion(label) {
  if (!label || typeof label !== "string") return null;
  const s = label.trim();

  // "U19" or "Under 19" → maxAge: 19
  const under = s.match(/^(?:U|Under\s*)(\d{1,2})\s*$/i);
  if (under) return { minAge: null, maxAge: Number(under[1]), gender: "any" };

  // "U19+" or "Over 19" or "Veterans 35+" → minAge: 19/35
  const over = s.match(/^(?:U(\d{1,2})\+|Over\s*(\d{1,2})|Veterans?\s*(\d{1,2})\+?)$/i);
  if (over) {
    const n = Number(over[1] || over[2] || over[3]);
    return { minAge: n, maxAge: null, gender: "any" };
  }

  // "19-35" → range
  const range = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (range) {
    return { minAge: Number(range[1]), maxAge: Number(range[2]), gender: "any" };
  }

  // "Open" / "Senior" / "Open Category"
  if (/^(open|senior)/i.test(s)) {
    return { minAge: null, maxAge: null, gender: "any" };
  }

  return null;
}

// ─── Read endpoints ───
// Managers + players see only active templates. SuperAdmin can see all.
exports.listTemplates = async (req, res) => {
  try {
    const includeInactive = req.isSuperAdmin && req.query.all === "1";
    const filter = includeInactive ? {} : { isActive: true };
    const templates = await CategoryTemplate.find(filter).sort({ minAge: 1, maxAge: 1, label: 1 });
    return res.json({ success: true, templates });
  } catch (err) {
    console.error("[categoryTemplate] list failed:", err);
    return res.status(500).json({ success: false, message: "Failed to list templates" });
  }
};

exports.getTemplate = async (req, res) => {
  try {
    const tpl = await CategoryTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, message: "Template not found" });
    return res.json({ success: true, template: tpl });
  } catch (err) {
    console.error("[categoryTemplate] get failed:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch template" });
  }
};

// Suggests min/max/gender from the label — used by the SA create form to
// pre-fill fields. Idempotent; safe to call on every keystroke.
exports.suggestFromLabel = async (req, res) => {
  const suggestion = parseLabelSuggestion(req.query.label || "");
  return res.json({ success: true, suggestion });
};

// ─── Write endpoints (SuperAdmin only) ───
exports.createTemplate = async (req, res) => {
  try {
    const { label, code, minAge, maxAge, gender, description, isActive } = req.body;
    if (!label || !code) {
      return res.status(400).json({ success: false, message: "label and code are required" });
    }
    const tpl = await CategoryTemplate.create({
      label: String(label).trim(),
      code:  String(code).trim().toUpperCase(),
      minAge: minAge == null || minAge === "" ? null : Number(minAge),
      maxAge: maxAge == null || maxAge === "" ? null : Number(maxAge),
      gender: gender || "any",
      description: description || "",
      isActive: isActive !== false,
      createdBy: req.accountId || null,
    });
    return res.status(201).json({ success: true, template: tpl });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "label or code already exists" });
    }
    console.error("[categoryTemplate] create failed:", err);
    return res.status(500).json({ success: false, message: "Failed to create template" });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const patch = {};
    const { label, code, minAge, maxAge, gender, description, isActive } = req.body;
    if (label !== undefined)       patch.label = String(label).trim();
    if (code !== undefined)        patch.code = String(code).trim().toUpperCase();
    if (minAge !== undefined)      patch.minAge = minAge === "" || minAge === null ? null : Number(minAge);
    if (maxAge !== undefined)      patch.maxAge = maxAge === "" || maxAge === null ? null : Number(maxAge);
    if (gender !== undefined)      patch.gender = gender;
    if (description !== undefined) patch.description = description;
    if (isActive !== undefined)    patch.isActive = !!isActive;

    const tpl = await CategoryTemplate.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
    if (!tpl) return res.status(404).json({ success: false, message: "Template not found" });
    return res.json({ success: true, template: tpl });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "label or code already exists" });
    }
    console.error("[categoryTemplate] update failed:", err);
    return res.status(500).json({ success: false, message: "Failed to update template" });
  }
};

// Hard delete is only allowed if the template has never been used. Otherwise
// callers should deactivate (PATCH isActive: false). The usage check looks
// for any tournament whose sports.categories contains this templateId.
exports.deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const used = await Tournament.countDocuments({ "sports.categories.templateId": id });
    if (used > 0) {
      return res.status(409).json({
        success: false,
        message: `Template is in use by ${used} tournament(s). Deactivate instead.`,
        usageCount: used,
      });
    }
    const tpl = await CategoryTemplate.findByIdAndDelete(id);
    if (!tpl) return res.status(404).json({ success: false, message: "Template not found" });
    return res.json({ success: true, deleted: id });
  } catch (err) {
    console.error("[categoryTemplate] delete failed:", err);
    return res.status(500).json({ success: false, message: "Failed to delete template" });
  }
};

// Returns how many tournaments reference each template — used by the SA UI
// to show "in use by N" warnings before edit/delete.
exports.getUsageCounts = async (req, res) => {
  try {
    const counts = await Tournament.aggregate([
      { $unwind: "$sports" },
      { $unwind: "$sports.categories" },
      { $match: { "sports.categories.templateId": { $ne: null } } },
      { $group: { _id: "$sports.categories.templateId", count: { $sum: 1 } } },
    ]);
    const byId = {};
    counts.forEach((c) => { byId[String(c._id)] = c.count; });
    return res.json({ success: true, usage: byId });
  } catch (err) {
    console.error("[categoryTemplate] usage failed:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch usage" });
  }
};

// Idempotent seed — inserts missing templates by code, leaves existing rows
// untouched (including any superadmin edits). Returns counts so the UI can
// show a useful toast.
exports.seedTemplates = async (req, res) => {
  try {
    let inserted = 0;
    let skipped = 0;
    for (const spec of SEED_TEMPLATES) {
      const existing = await CategoryTemplate.findOne({ code: spec.code });
      if (existing) { skipped++; continue; }
      await CategoryTemplate.create(spec);
      inserted++;
    }
    return res.json({ success: true, inserted, skipped, total: SEED_TEMPLATES.length });
  } catch (err) {
    console.error("[categoryTemplate] seed failed:", err);
    return res.status(500).json({ success: false, message: "Failed to seed templates" });
  }
};
