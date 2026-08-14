/**
 * Razorpay service — real gateway order-creation + server-side signature
 * verification. Ported from the proven IONIX landing integration (SDK-free:
 * uses fetch + crypto). Config-driven via env, so the SAME code runs on test
 * keys (QA) and live keys (prod) with no change:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *
 * This is the fix for the "payments are trust-based" gap: a booking/registration
 * must ONLY be marked paid after verifySignature() returns true for a real
 * Razorpay payment — never on client assertion alone.
 */
const crypto = require("crypto");

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

/** True once key id + secret are present in env (test or live). */
function isConfigured() {
  return Boolean(KEY_ID && KEY_SECRET);
}

/** The publishable key id the client checkout needs (never the secret). */
function publicKeyId() {
  return KEY_ID;
}

/**
 * Create a real Razorpay order. `amountPaise` is an integer in paise (₹1 = 100).
 * Returns the Razorpay order object ({ id, amount, currency, ... }).
 */
async function createOrder({ amountPaise, receipt, notes = {} }) {
  if (!isConfigured()) {
    const err = new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server .env.");
    err.statusCode = 503;
    throw err;
  }
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount < 100) {
    const err = new Error("Invalid payment amount (minimum ₹1).");
    err.statusCode = 400;
    throw err;
  }
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount, currency: "INR", receipt, notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || data?.message || "Could not create Razorpay order");
    err.statusCode = 502;
    throw err;
  }
  return data;
}

/**
 * Verify a checkout callback signature: HMAC-SHA256(`${orderId}|${paymentId}`, KEY_SECRET)
 * must equal razorpay_signature. Timing-safe. Returns boolean — the ONLY thing
 * that may authorize marking a booking paid.
 */
function verifySignature({ orderId, paymentId, signature }) {
  if (!KEY_SECRET || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify a Razorpay WEBHOOK payload: HMAC-SHA256(rawBody, WEBHOOK_SECRET) must
 * equal the X-Razorpay-Signature header. `rawBody` must be the raw request body
 * string/Buffer (not the parsed object). Timing-safe.
 */
function verifyWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET || !rawBody || !signature) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"))
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, publicKeyId, createOrder, verifySignature, verifyWebhook };
