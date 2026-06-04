"use strict";
/**
 * Per-request tenant context (Phase 1.1 multi-tenancy).
 *
 * Holds the resolved tenant for the current request in an AsyncLocalStorage
 * store so the tenantScope Mongoose plugin can auto-scope queries WITHOUT
 * threading clubId through every controller/service call.
 *
 *   ctx = { clubId?: string, principalType?: string, isSuperAdmin?: boolean }
 *
 * Tenant model (see audit): a "club"/tenant is a ClubAdmin or corporate_admin
 * User _id — the same convention Manager.clubId already uses. Club-staff
 * principals carry a clubId and get scoped:
 *   • ClubAdmin / corporate_admin → clubId = their own User _id
 *   • Manager                     → clubId = manager.clubId
 * Cross-tenant principals carry NO clubId and are never force-scoped:
 *   • Player, Trainer, Referee, Vendor, public
 * SuperAdmin sees everything (isSuperAdmin:true → scoping skipped).
 *
 * The context is established once, in the auth middleware, by wrapping next()
 * in runWithTenant(). Downstream middleware/handlers (and their awaits) inherit
 * the store automatically via async_hooks.
 */
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

// User.role strings that own a club (the tenant root is their own User _id).
const TENANT_OWNER_ROLES = ["ClubAdmin", "corporate_admin"];

/** Run `fn` with the given tenant context active for the whole async chain. */
function runWithTenant(ctx, fn) {
  return als.run(ctx || {}, fn);
}

/** Current tenant context, or null if none was established for this request. */
function getTenant() {
  return als.getStore() || null;
}

/** Current tenant clubId, or null (cross-tenant / unauthenticated / superadmin). */
function getClubId() {
  const s = als.getStore();
  return s && s.clubId ? s.clubId : null;
}

/**
 * Build the tenant context for a User principal from its role + id.
 * Owner roles → scoped to their own id; everyone else → cross-tenant (no clubId).
 */
function contextForUser(role, userId) {
  if (TENANT_OWNER_ROLES.includes(role)) {
    return { clubId: String(userId), principalType: role };
  }
  return { principalType: role || "User" };
}

module.exports = {
  als,
  runWithTenant,
  getTenant,
  getClubId,
  contextForUser,
  TENANT_OWNER_ROLES,
};
