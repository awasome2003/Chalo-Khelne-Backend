"use strict";
/**
 * Pagination helper for list endpoints.
 *
 * §3.10.3 / §8.2.3 — six list endpoints ran `find()` with no limit, no
 * pagination and no projection. Response size and memory grew linearly with the
 * table forever: they are cheap today because the tables are small, and they
 * get slower every day the platform is used, with no failure point that would
 * make anyone notice before it hurts.
 *
 * Applying a DEFAULT limit is the important part. Callers that pass ?page/?limit
 * get real pagination; callers that pass nothing (every existing client) stop
 * being able to ask for the whole table by accident.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Parse page/limit from a request, clamped to sane bounds.
 * @returns {{page: number, limit: number, skip: number}}
 */
function parsePagination(req, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawPage = Number.parseInt(req.query?.page, 10);
  const rawLimit = Number.parseInt(req.query?.limit, 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Set the pagination response headers the web client already reads
 * (app.js exposes X-Total-Count / X-Total-Pages / X-Page / X-Limit via CORS).
 */
function setPaginationHeaders(res, { total, page, limit }) {
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Total-Pages", String(Math.max(1, Math.ceil(total / limit))));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Limit", String(limit));
}

/**
 * Run a paginated find against a model and set the headers.
 *
 * Kept deliberately small: it returns the ARRAY, so an endpoint that currently
 * responds with a bare array (which all six of these do) keeps its response
 * shape and no client breaks. The count travels in the headers instead.
 *
 * @param {import("mongoose").Model} Model
 * @param {object} opts
 * @param {object} [opts.filter]
 * @param {object|string} [opts.select]
 * @param {object} [opts.sort]
 * @param {Array<[string, string]|{path: string, select?: string}>} [opts.populate]
 */
async function paginatedFind(Model, req, res, opts = {}) {
  const { page, limit, skip } = parsePagination(req, opts);
  const filter = opts.filter || {};

  let query = Model.find(filter).skip(skip).limit(limit);
  if (opts.select) query = query.select(opts.select);
  if (opts.sort) query = query.sort(opts.sort);
  for (const p of opts.populate || []) query = query.populate(p);
  if (opts.lean) query = query.lean();

  const [items, total] = await Promise.all([
    query.exec(),
    Model.countDocuments(filter),
  ]);

  setPaginationHeaders(res, { total, page, limit });
  return items;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  setPaginationHeaders,
  paginatedFind,
};
