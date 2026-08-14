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
 * §3.9 — aggregate() IS now scoped (see the pre("aggregate") hook below).
 * Previously it was not, and the gap was closed by hand: a tenantMatchStage()
 * helper existed and was used correctly at 10 of 27 aggregate() call sites. The
 * other 17 were safe only transitively — they constrained on an id list that
 * had itself been produced by a plugin-scoped query. That is not isolation, it
 * is a property that has to be re-established by reading each pipeline, and
 * nothing failed when a new aggregate was added without the stage.
 *
 * Notes / current limitations:
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

  // ── aggregate() scoping (§3.9) ─────────────────────────────────────────
  //
  // Injects the same { field: clubId } constraint as a leading $match, so a
  // pipeline is isolated whether or not its author remembered
  // tenantMatchStage(). Structural, not conventional.
  //
  // Deliberate details:
  //  • Skipped entirely when the pipeline already has an explicit $match on
  //    `field` — a call site that scopes itself (or intentionally reaches
  //    across tenants with an explicit filter) keeps its own behaviour, and the
  //    10 existing tenantMatchStage() call sites do not get a duplicate stage.
  //  • Unshifted to the FRONT so it filters before $lookup/$group/$unwind,
  //    which is both correct and the cheapest position.
  //  • Same escape hatches as queryScope: no context, cross-tenant actor, or
  //    SuperAdmin → untouched.
  //  • Honours `enforce`, so a model still in shadow mode is not silently
  //    changed by this hook.
  schema.pre("aggregate", function (next) {
    const t = getTenant();
    if (!t || t.isSuperAdmin || !t.clubId) return next();

    const pipeline = this.pipeline();
    if (!Array.isArray(pipeline)) return next();

    // Already scoped by hand? Leave it alone.
    const alreadyScoped = pipeline.some(
      (stage) =>
        stage &&
        stage.$match &&
        Object.prototype.hasOwnProperty.call(stage.$match, field)
    );
    if (alreadyScoped) return next();

    // $merge / $out write results elsewhere; prepending a filter to those is
    // still correct, but a $geoNear MUST remain the first stage, so bail rather
    // than produce an invalid pipeline.
    if (pipeline.length > 0 && pipeline[0] && pipeline[0].$geoNear) {
      console.warn(
        `[tenantScope] ${this._model?.modelName || "?"}.aggregate starts with ` +
          `$geoNear — cannot prepend a tenant $match. Add tenantMatchStage() by hand.`
      );
      return next();
    }

    if (enforce) {
      pipeline.unshift({
        $match: { [field]: new mongoose.Types.ObjectId(String(t.clubId)) },
      });
    } else if (process.env.TENANT_SHADOW_LOG === "1") {
      try {
        console.log(
          `[tenantScope:shadow] ${this._model?.modelName}.aggregate → would scope ${field}=${t.clubId}`
        );
      } catch (_) {}
    }
    next();
  });
};
