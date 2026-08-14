/**
 * Shared rate limiters.
 *
 * §3.2 — rate limiting used to exist ONLY on /login and /register, defined
 * inline in authRoutes.js. That left exactly the wrong subset open:
 *
 *   • verify-otp has no attempt counter of its own, and an OTP is a short
 *     numeric code — unlimited attempts is a brute force with a small keyspace;
 *   • send-otp is an unmetered outbound-EMAIL trigger, i.e. a free relay for
 *     anyone who wants to spam an address or burn the sending quota;
 *   • the password-reset routes were likewise unlimited.
 *
 * The limiters live here so every sensitive route pulls from one definition
 * instead of each file inventing its own (or forgetting to).
 */

// Defensive require, but NOT silently permissive.
//
// The old fallback was `() => (req,res,next) => next()` behind a console
// warning: if the package were ever missing, authentication would be silently
// unlimited and the only evidence would be one line in a busy boot log. It now
// refuses to boot in production, where "no rate limiting" is not an acceptable
// degraded mode, and stays a no-op only in dev/test where it is.
let rateLimit;
try {
  rateLimit = require("express-rate-limit");
} catch (_e) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[rate-limit] express-rate-limit is not installed. Refusing to boot in " +
        "production without rate limiting. Run: npm install express-rate-limit"
    );
  }
  console.warn(
    "[rate-limit] express-rate-limit not installed — limiting DISABLED (dev/test only). " +
      "Run: npm install express-rate-limit"
  );
  rateLimit = () => (_req, _res, next) => next();
}

const rateLimitStore = require("./rateLimitStore");

/**
 * Build a limiter with a Redis-backed store when REDIS_URL is set.
 * @param {string} prefix  unique Redis key prefix — counters collide without it
 */
function makeLimiter({ prefix, windowMs, max, message }) {
  const store = rateLimitStore(prefix);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: message || "Too many attempts. Please try again later.",
    },
    ...(store ? { store } : {}),
  });
}

// ── Presets ─────────────────────────────────────────────────────────────────

// Login. Generous enough that a real user fumbling a password never notices.
const authLimiter = makeLimiter({
  prefix: "rl:auth:",
  windowMs: 15 * 60 * 1000,
  max: 20,
});

const registerLimiter = makeLimiter({
  prefix: "rl:register:",
  windowMs: 60 * 60 * 1000,
  max: 10,
});

// Sending an OTP costs us an email. Tight, because the only legitimate reason
// to ask repeatedly is a message that did not arrive.
const otpSendLimiter = makeLimiter({
  prefix: "rl:otp-send:",
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many OTP requests. Please wait a few minutes and try again.",
});

// Verifying an OTP is the brute-force surface: a short numeric code with no
// per-code attempt counter behind it. This limiter IS the attempt counter.
const otpVerifyLimiter = makeLimiter({
  prefix: "rl:otp-verify:",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many verification attempts. Please request a new code.",
});

// Password reset — both the request-a-link step and the consume-a-token step.
const passwordResetLimiter = makeLimiter({
  prefix: "rl:pwreset:",
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Please try again later.",
});

module.exports = {
  makeLimiter,
  authLimiter,
  registerLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  passwordResetLimiter,
};
