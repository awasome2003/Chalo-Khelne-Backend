/**
 * Server-side pagination helpers (SuperAdmin list endpoints).
 *
 * Contract is NON-BREAKING: pagination only activates when the request carries
 * a `page` (or `limit`) query param. Legacy callers (incl. the frozen mobile
 * app and other web screens) that call without those params still get the old
 * response shape untouched — the controller decides via `paged`.
 *
 * Usage in a controller:
 *   const { parsePaging, pageMeta } = require("../utils/paginate");
 *   const { paged, page, limit, skip } = parsePaging(req);
 *   if (!paged) return res.json(await Model.find(filter));      // legacy shape
 *   const [items, total] = await Promise.all([
 *     Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
 *     Model.countDocuments(filter),
 *   ]);
 *   return res.json({ items, ...pageMeta(total, page, limit) });
 */

function parsePaging(req, { defaultLimit = 10, maxLimit = 100 } = {}) {
  const q = (req && req.query) || {};
  const paged = q.page != null || q.limit != null;

  let page = parseInt(q.page, 10);
  let limit = parseInt(q.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  return { paged, page, limit, skip: (page - 1) * limit };
}

function pageMeta(total, page, limit) {
  const safeLimit = limit > 0 ? limit : 1;
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

// Build a case-insensitive OR regex filter across the given fields from `?q=`.
// Returns {} when there's no search term, so it composes with a base filter.
function searchFilter(req, fields = []) {
  const term = (req && req.query && req.query.q ? String(req.query.q) : "").trim();
  if (!term || fields.length === 0) return {};
  // Escape regex metacharacters in user input.
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(safe, "i");
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

module.exports = { parsePaging, pageMeta, searchFilter };
