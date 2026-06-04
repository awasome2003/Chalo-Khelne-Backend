/**
 * Escape a user-supplied string so it can be used as a LITERAL inside a
 * `new RegExp(...)` / `$regex` query. Prevents both regex injection and
 * ReDoS (catastrophic backtracking) from attacker-controlled search input.
 *
 *   const rx = new RegExp(`^${escapeRegex(name)}$`, "i");
 */
function escapeRegex(input) {
  return String(input == null ? "" : input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = escapeRegex;
