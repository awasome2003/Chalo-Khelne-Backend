/**
 * Async error safety net for Express route handlers.
 *
 * Express 4 does NOT catch rejected promises from async handlers — a single
 * `await something()` that throws becomes an unhandledRejection that can take
 * the whole process down. `asyncHandler` wraps a handler so any throw/rejection
 * is forwarded to `next(err)` and lands in the global error handler as a clean
 * 500 instead of crashing the server.
 *
 * Two ways to use it:
 *   1. Explicitly:   router.get("/x", asyncHandler(myController))
 *   2. Globally:     installGlobalAsyncWrapping(express)  // called once in app.js
 *      → auto-wraps EVERY handler registered via router.get/post/put/... so all
 *        ~437 existing controllers are protected without editing each call site
 *        (hand-wrapping 437 sites would be unreviewable and easy to miss).
 */
"use strict";

function asyncHandler(fn) {
  if (typeof fn !== "function") return fn;
  // 4-arg functions are Express error handlers (err, req, res, next) — never wrap.
  if (fn.length >= 4) return fn;
  if (fn.__asyncWrapped) return fn;

  const wrapped = function (req, res, next) {
    try {
      const result = fn.call(this, req, res, next);
      // Only async handlers return a thenable; forward rejections to next().
      if (result && typeof result.then === "function") {
        return result.catch(next);
      }
      return result;
    } catch (err) {
      // Synchronous throw inside an (async or sync) handler.
      return next(err);
    }
  };
  wrapped.__asyncWrapped = true;
  wrapped.__original = fn; // keep the original around for debugging/stack clarity
  return wrapped;
}

// Wrap every handler-ish argument passed to a route method. Path args
// (string/RegExp) pass through; arrays of handlers are wrapped element-wise.
function wrapHandlerArgs(args) {
  return args.map((arg) => {
    if (typeof arg === "function") return asyncHandler(arg);
    if (Array.isArray(arg)) {
      return arg.map((a) => (typeof a === "function" ? asyncHandler(a) : a));
    }
    return arg;
  });
}

// Route-registration methods whose trailing args are request handlers.
const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"];

/**
 * installGlobalAsyncWrapping(express) — monkey-patches the Express Router (and,
 * transitively, app.METHOD which delegates to it) plus per-route chains created
 * via router.route(). Idempotent. MUST be called before any routes are mounted.
 */
function installGlobalAsyncWrapping(express) {
  if (!express || typeof express.Router !== "function") return;

  // express.Router is the factory whose own properties ARE the instance methods
  // (router instances are setPrototypeOf'd to it in Express 4).
  const routerProto = express.Router;
  if (!routerProto.__asyncPatched) {
    ROUTE_METHODS.forEach((method) => {
      const original = routerProto[method];
      if (typeof original !== "function") return;
      routerProto[method] = function (...args) {
        return original.apply(this, wrapHandlerArgs(args));
      };
    });

    // router.route("/x").get(handler) uses the Route prototype, not the Router
    // prototype — patch it too so those handlers are covered. We reach the Route
    // class via a throwaway router's route() and patch its prototype once.
    try {
      const sampleRoute = express.Router().route("/__async_probe__");
      const RouteProto = Object.getPrototypeOf(sampleRoute);
      if (RouteProto && !RouteProto.__asyncPatched) {
        ROUTE_METHODS.forEach((method) => {
          const original = RouteProto[method];
          if (typeof original !== "function") return;
          RouteProto[method] = function (...args) {
            return original.apply(this, wrapHandlerArgs(args));
          };
        });
        RouteProto.__asyncPatched = true;
      }
    } catch (_) {
      // If internals shift in a future Express, verb-method patching above still
      // covers the common router.get/post/... usage; route() chains are rare here.
    }

    routerProto.__asyncPatched = true;
  }
}

module.exports = asyncHandler;
module.exports.asyncHandler = asyncHandler;
module.exports.installGlobalAsyncWrapping = installGlobalAsyncWrapping;
