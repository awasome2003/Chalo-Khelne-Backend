"use strict";
/**
 * Uniform array shuffle (Fisher–Yates).
 *
 * WHY THIS EXISTS
 * ---------------
 * The draw code used `[...arr].sort(() => Math.random() - 0.5)` in five places.
 * That is not a shuffle. A comparator must be a consistent ordering; a random
 * one violates the contract, so the result depends entirely on the sort
 * algorithm's access pattern. V8 uses TimSort, which on small arrays does an
 * insertion sort and therefore leaves elements close to where they started —
 * the output is measurably biased toward the input order.
 *
 * For a tournament that is not a cosmetic issue: input order IS seed order, and
 * seed order maps to fixed bracket lines. A biased "random draw" quietly favours
 * whoever appears first in the list, which is exactly the thing a random draw is
 * supposed to rule out — and it is the kind of unfairness a player can contest.
 *
 * Fisher–Yates gives each of the n! permutations equal probability.
 *
 * @param {Array}    arr   Source array. Never mutated.
 * @param {Function} [rng] Random source returning [0, 1). Injectable for tests.
 * @returns {Array} A new, uniformly shuffled array.
 */
function shuffle(arr, rng = Math.random) {
  const out = Array.isArray(arr) ? [...arr] : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = { shuffle };
