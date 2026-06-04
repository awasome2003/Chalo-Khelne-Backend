/**
 * Parse + clamp pagination params from a request query.
 * Enforces a hard max so a client can't request an unbounded page
 * (e.g. ?limit=999999). Returns { page, limit, skip }.
 */
function parsePagination(req, { defaultLimit = 50, maxLimit = 100 } = {}) {
  let page = parseInt(req.query.page, 10);
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { parsePagination };
