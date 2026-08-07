// Coupon evaluation and redemption — the single place coupon money is decided.
//
// §2.7 — what this replaces:
//
//   (a) The discount never reached the booking. BookingModel declared no coupon
//       field and BookingController never read one, so applying a coupon changed
//       a number on the client and nothing on the server. The player still owed
//       the full totalFee and the manager's screen still showed it.
//
//   (b) The per-user limit was checked against a user id the CLIENT supplied
//       (`if (user_id) { … }`). The route is authenticated, so req.user was
//       available and correct — it was simply not used. Omitting user_id from
//       the body skipped the guard entirely, because the whole block was
//       conditional on the field being present.
//
//   (c) The global limit was enforced by asking the client to report its own
//       usage. `validate` and `recordUsage` were two independent calls with
//       nothing linking them — no reservation, no booking reference, no expiry.
//       A client that validated and never called record-usage kept the coupon
//       good forever, for everyone. recordUsage also took originalAmount,
//       discountAmount and finalAmount straight from the body and wrote them to
//       the ledger the analytics endpoint sums, and incremented usedCount with a
//       read-modify-write that loses concurrent increments.
//
// The shape now: `quoteCoupon` is a pure preview with no side effects, and
// `redeemCoupon` is a single atomic operation that re-derives every number
// server-side and claims the usage slot with a conditional $inc. Callers pass
// the booking's session so redemption commits or rolls back with the booking.

const mongoose = require("mongoose");
const Coupon = require("../src/modules/commerce/models/Coupon");
const CouponUsage = require("../src/modules/commerce/models/CouponUsage");

class CouponError extends Error {
  constructor(message, code = "COUPON_INVALID") {
    super(message);
    this.name = "CouponError";
    this.code = code;
  }
}

// Discount is derived from the coupon document and the SERVER's total. Nothing
// here reads a client-supplied amount.
function computeDiscount(coupon, totalAmount) {
  let discount;
  if (coupon.discountType === "percentage") {
    discount = Math.round((totalAmount * coupon.discountValue) / 100);
    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount;
    }
  } else {
    discount = coupon.discountValue;
  }
  // Never discount below zero, and never below the order total.
  discount = Math.max(0, Math.min(Math.round(discount), Math.round(totalAmount)));
  return { discountAmount: discount, finalAmount: Math.round(totalAmount) - discount };
}

/**
 * Evaluate a coupon without changing anything. Used by the /validate preview.
 *
 * @param {object} args
 * @param {string} args.code
 * @param {string} args.userId        — ALWAYS from the token, never the body
 * @param {string} [args.applicableTo] — "tournament" | "facility"
 * @param {string} [args.applicableId]
 * @param {number} args.totalAmount   — server-derived order total
 * @returns {Promise<{valid: boolean, message: string, coupon?: object,
 *                    discountAmount?: number, finalAmount?: number}>}
 */
async function quoteCoupon({ code, userId, applicableTo, applicableId, totalAmount }, opts = {}) {
  const session = opts.session;

  if (!code) return { valid: false, message: "Coupon code is required" };
  if (!userId) return { valid: false, message: "Sign in to use a coupon" };

  const amount = Number(totalAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { valid: false, message: "Invalid order amount" };
  }

  const query = Coupon.findOne({ code: String(code).toUpperCase().trim() });
  if (session) query.session(session);
  const coupon = await query;

  if (!coupon) return { valid: false, message: "Invalid coupon code" };
  if (!coupon.isActive) {
    return { valid: false, message: "This coupon is no longer active" };
  }
  if (new Date(coupon.expiryDate) <= new Date()) {
    return { valid: false, message: "This coupon has expired" };
  }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, message: "This coupon has reached its usage limit" };
  }
  if (coupon.applicableTo !== "all" && applicableTo && coupon.applicableTo !== applicableTo) {
    return {
      valid: false,
      message: `This coupon is only valid for ${coupon.applicableTo} bookings`,
    };
  }
  if (coupon.applicableId && applicableId
      && String(coupon.applicableId) !== String(applicableId)) {
    return { valid: false, message: "This coupon is not valid for this item" };
  }
  if (amount < coupon.minAmount) {
    return { valid: false, message: `Minimum order amount is ₹${coupon.minAmount}` };
  }

  // Per-user limit — unconditional, and keyed on the authenticated user. The
  // old code wrapped this in `if (user_id)`, so a request that omitted the
  // field skipped the check completely.
  const usageQuery = CouponUsage.countDocuments({
    couponId: coupon._id,
    userId,
  });
  if (session) usageQuery.session(session);
  const userUsageCount = await usageQuery;

  if (userUsageCount >= coupon.perUserLimit) {
    return {
      valid: false,
      message: `You have already used this coupon${
        coupon.perUserLimit > 1 ? ` ${coupon.perUserLimit} times` : ""
      }`,
    };
  }

  const { discountAmount, finalAmount } = computeDiscount(coupon, amount);
  return {
    valid: true,
    message: `Coupon applied! You save ₹${discountAmount}`,
    coupon,
    discountAmount,
    finalAmount,
  };
}

/**
 * Evaluate AND claim a coupon in one atomic operation.
 *
 * Throws CouponError when the coupon cannot be applied, so a caller inside a
 * transaction aborts the whole write rather than creating a booking that
 * believes it got a discount it never claimed.
 *
 * @param {object} args — same as quoteCoupon, plus:
 * @param {string} args.appliedTo — "tournament" | "facility" (CouponUsage enum)
 * @param {string} args.appliedId — the tournament/facility the coupon applies to
 * @param {import("mongoose").ClientSession} [opts.session]
 * @returns {Promise<{couponId, code, discountAmount, finalAmount, originalAmount}>}
 */
async function redeemCoupon(
  { code, userId, appliedTo, appliedId, totalAmount },
  opts = {}
) {
  const session = opts.session;

  const quote = await quoteCoupon(
    {
      code,
      userId,
      applicableTo: appliedTo,
      applicableId: appliedId,
      totalAmount,
    },
    { session }
  );

  if (!quote.valid) throw new CouponError(quote.message);

  const { coupon, discountAmount, finalAmount } = quote;
  const originalAmount = Math.round(Number(totalAmount));

  // Claim the global slot atomically. The filter carries the cap, so two
  // concurrent redemptions of the last remaining use cannot both succeed —
  // `coupon.usedCount += 1; save()` (a read-modify-write) lost increments and
  // let the cap be exceeded.
  const claimFilter = { _id: coupon._id };
  if (coupon.usageLimit) {
    claimFilter.usedCount = { $lt: coupon.usageLimit };
  }

  const claimed = await Coupon.findOneAndUpdate(
    claimFilter,
    { $inc: { usedCount: 1 } },
    { new: true, session }
  );

  if (!claimed) {
    throw new CouponError("This coupon has reached its usage limit");
  }

  // Ledger row with SERVER-computed amounts. recordUsage used to write whatever
  // the client posted, which is what the manager's coupon analytics summed.
  const [usage] = await CouponUsage.create(
    [
      {
        couponId: coupon._id,
        userId,
        couponCode: coupon.code,
        appliedTo,
        appliedId,
        originalAmount,
        discountAmount,
        finalAmount,
      },
    ],
    { session }
  );

  return {
    couponId: coupon._id,
    code: coupon.code,
    usageId: usage._id,
    originalAmount,
    discountAmount,
    finalAmount,
  };
}

module.exports = { quoteCoupon, redeemCoupon, computeDiscount, CouponError };
