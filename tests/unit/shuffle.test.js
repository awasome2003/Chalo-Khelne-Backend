"use strict";
/**
 * Uniform shuffle.
 *
 * The draw code previously used `sort(() => Math.random() - 0.5)`, which is not
 * a shuffle — a random comparator breaks the ordering contract, so the result
 * depends on the sort algorithm and stays biased toward the input order. Since
 * input order IS seed order, that quietly advantaged whoever was listed first.
 *
 * The distribution test below is the one that matters: it passes for
 * Fisher-Yates and fails for the comparator trick.
 */
const { shuffle } = require("../../utils/shuffle");

describe("shuffle", () => {
  test("returns a permutation — same elements, same length", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(src);
    expect(out).toHaveLength(src.length);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });

  test("does not mutate the input", () => {
    const src = ["a", "b", "c", "d"];
    const copy = [...src];
    shuffle(src);
    expect(src).toEqual(copy);
  });

  test("handles empty, single-element and non-array input", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["only"])).toEqual(["only"]);
    expect(shuffle(null)).toEqual([]);
    expect(shuffle(undefined)).toEqual([]);
  });

  test("is deterministic under an injected random source", () => {
    // rng always returns 0 ⇒ every swap targets index 0, rotating the array:
    // [1,2,3,4] → i=3 [4,2,3,1] → i=2 [3,2,4,1] → i=1 [2,3,4,1]
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
    // rng returning just under 1 ⇒ every swap picks index i, i.e. identity.
    expect(shuffle([1, 2, 3, 4], () => 0.999999)).toEqual([1, 2, 3, 4]);
  });

  test("distributes each element across all positions roughly evenly", () => {
    const N = 24000;
    const size = 8;
    const src = Array.from({ length: size }, (_, i) => i);

    // counts[element][position]
    const counts = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let run = 0; run < N; run++) {
      const out = shuffle(src);
      out.forEach((el, pos) => { counts[el][pos] += 1; });
    }

    // Uniform ⇒ every element lands in every position N/size times.
    const expected = N / size; // 3000
    const tolerance = expected * 0.25; // generous, so this is not flaky

    for (let el = 0; el < size; el++) {
      for (let pos = 0; pos < size; pos++) {
        expect(Math.abs(counts[el][pos] - expected)).toBeLessThan(tolerance);
      }
    }
  });

  test("element 0 does not cling to the front (the specific old bias)", () => {
    const N = 12000;
    const src = [0, 1, 2, 3, 4, 5, 6, 7];
    let stayedFirst = 0;
    for (let run = 0; run < N; run++) {
      if (shuffle(src)[0] === 0) stayedFirst += 1;
    }
    // Should be ~1/8 of runs. The comparator shuffle kept it first far more.
    const rate = stayedFirst / N;
    expect(rate).toBeGreaterThan(0.09);
    expect(rate).toBeLessThan(0.16);
  });
});
