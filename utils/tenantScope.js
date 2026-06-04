"use strict";
/**
 * tenantScope — opt-in Mongoose plugin for multi-tenant data isolation (Phase 1.1).
 *
 * Apply per model:
 *   schema.plugin(tenantScope, { field: "clubId", enforce: false })
 *
 *  • create / save / insertMany: stamps `field` from the request's tenant
 *    context when the document doesn't already carry one.
 *  • find / update / delete / count queries: when the caller is club-staff
 *    (tenant context has a clubId and is not SuperAdmin) AND the query doesn't
 *    already filter on `field`, scope it to that clubId.
 *
 * `enforce` flag controls the read/update/delete path:
 *  • false (DEFAULT) = SHADOW MODE — stamps writes + (optionally) logs what it
 *    WOULD scope, but does NOT modify any query filter. Safe to deploy before
 *    the backfill has run. Set TENANT_SHADOW_LOG=1 to see the would-scope logs.
 *  • true            = ENFORCE — actually injects { field: clubId } into the
 *    filter. Flip to this per-model only AFTER backfilling + verifying.
 *
 * Notes / current limitations (addressed in later steps):
 *  • aggregate() is NOT scoped yet.
 *  • upsert-on-update does not stamp the inserted doc yet.
 */
const mongoose = require("mongoose");
const { getTenant } = require("./tenantContext");

const QUERY_OPS = [
  "count",
  "countDocuments",
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
];

module.exports = function tenantScope(schema, opts = {}) {
  const field = opts.field || "clubId";
  const enforce = !!opts.enforce;
  const addField = opts.addField !== false; // default: add the field if missing

  // Convenience: when a model doesn't already declare the tenant field, add it
  // (indexed, nullable, ref User). Lets a model opt in with a single plugin()
  // call instead of editing the schema by hand. Models that declare the field
  // themselves (Tournament/Booking/Payment) skip this — path already exists.
  if (addField && !schema.path(field)) {
    schema.add({
      [field]: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },
    });
  }

  // Resolve the tenant for a new doc: prefer the request context (club-staff),
  // else fall back to opts.derive(doc) — needed for docs created by cross-tenant
  // actors (e.g. a player creating a booking/payment), where the parent record
  // (tournament/turf) carries the real clubId. opts.derive is async.
  async function resolveClubId(doc) {
    const t = getTenant();
    if (t && t.clubId) return t.clubId;
    if (typeof opts.derive === "function") {
      try {
        return await opts.derive(doc);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  schema.pre("save", async function () {
    if (this.isNew && this[field] == null) {
      const v = await resolveClubId(this);
      if (v) this[field] = v;
    }
  });

  schema.pre("insertMany", async function (next, docs) {
    if (Array.isArray(docs)) {
      for (const d of docs) {
        if (d[field] == null) {
          const v = await resolveClubId(d);
          if (v) d[field] = v;
        }
      }
    }
    next();
  });

  function queryScope(next) {
    const t = getTenant();
    // No context, cross-tenant actor, or SuperAdmin → never force-scope.
    if (!t || t.isSuperAdmin || !t.clubId) return next();

    const filter = this.getFilter() || {};
    if (filter[field] !== undefined) return next(); // explicit scope already present

    if (enforce) {
      this.where({ [field]: t.clubId });
    } else if (process.env.TENANT_SHADOW_LOG === "1") {
      try {
        console.log(
          `[tenantScope:shadow] ${this.model.modelName}.${this.op} → would scope ${field}=${t.clubId}`
        );
      } catch (_) {}
    }
    next();
  }

  QUERY_OPS.forEach((op) => schema.pre(op, queryScope));
};
