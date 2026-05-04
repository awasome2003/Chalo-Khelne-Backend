// server/utils/seedingUtils.js

/**
 * seedingUtils -- Mirror & Flip seed-to-slot mapping for power-of-2 brackets.
 *
 * Algorithm (recursive doubling):
 *   Start: [1, 2]
 *
 *   Expand size -> 2*size:
 *     For each seed S at old index i:
 *       - S stays at new index (2i + (i % 2))
 *       - S's mirror (newSize + 1 - S) takes the companion slot
 *         at new index (2i + (1 - i % 2))
 *
 *   Produces:
 *     size 4  -> [1, 4, 3, 2]
 *     size 8  -> [1, 8, 5, 4, 3, 6, 7, 2]
 *     size 16 -> [1, 16, 9, 8, 5, 12, 13, 4, 3, 14, 11, 6, 7, 10, 15, 2]
 *
 *   Invariants:
 *     - Seed 1 and Seed 2 sit at opposite ends; can only meet in the final.
 *     - Every line pair (2k-1, 2k) of the first round has seeds summing to
 *       (size + 1) when fully seeded.
 */

const VALID_DRAW_SIZES = [4, 8, 16, 32, 64, 128];

/**
 * Seed-to-line order (1-indexed seed numbers, array index = line - 1).
 * e.g. getSeedOrder(8) -> [1, 8, 5, 4, 3, 6, 7, 2]
 */
const getSeedOrder = (size) => {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const newSize = seeds.length * 2;
    const next = new Array(newSize);
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const mirror = newSize + 1 - seed;
      // Even-index old seeds stay on the outer line of their new pair,
      // odd-index old seeds move to the inner line. Mirror takes the
      // companion slot.
      const seedSlot = 2 * i + (i % 2);
      const mirrorSlot = 2 * i + (1 - (i % 2));
      next[seedSlot] = seed;
      next[mirrorSlot] = mirror;
    }
    seeds = next;
  }
  return seeds;
};

/**
 * Preview table for the seeding layout.
 *
 * @param {number} drawSize       - one of VALID_DRAW_SIZES.
 * @param {number} numberOfSeeds  - 0..drawSize. Seeds 1..N are marked seeded.
 * @returns {Array<{lineNumber:number, seedNumber:number|null, isSeeded:boolean, label:string}>}
 *
 * BYE-marking is consumer-side (depends on actual player count).
 */
const generateSeedPositions = (drawSize, numberOfSeeds = 0) => {
  if (!VALID_DRAW_SIZES.includes(drawSize)) {
    throw new Error(`Invalid drawSize ${drawSize}. Valid: ${VALID_DRAW_SIZES.join(", ")}`);
  }
  if (numberOfSeeds < 0 || numberOfSeeds > drawSize) {
    throw new Error(`numberOfSeeds ${numberOfSeeds} out of range for drawSize ${drawSize}`);
  }

  const order = getSeedOrder(drawSize); // order[i] = seed sitting on line (i + 1)
  const rows = [];
  for (let line = 1; line <= drawSize; line++) {
    const seed = order[line - 1];
    if (seed <= numberOfSeeds) {
      rows.push({
        lineNumber: line,
        seedNumber: seed,
        isSeeded: true,
        label: `Seed ${seed}`,
      });
    } else {
      rows.push({
        lineNumber: line,
        seedNumber: null,
        isSeeded: false,
        label: "Unseeded",
      });
    }
  }
  return rows;
};

/** Draw sizes this algorithm supports. */
const getValidDrawSizes = () => [...VALID_DRAW_SIZES];

/** Recommended max seeded players for a draw (half the draw). */
const getMaxSeeds = (drawSize) => {
  if (!VALID_DRAW_SIZES.includes(drawSize)) return 0;
  return drawSize / 2;
};

/**
 * How many BYEs are needed to fill a bracket.
 * @param {number} totalPlayers
 * @param {number} drawSize - power-of-2; one of VALID_DRAW_SIZES.
 * @returns {number} 0 if totalPlayers >= drawSize, else the shortfall.
 */
const calculateByes = (totalPlayers, drawSize) => {
  if (!VALID_DRAW_SIZES.includes(drawSize)) {
    throw new Error(`Invalid drawSize ${drawSize}. Valid: ${VALID_DRAW_SIZES.join(", ")}`);
  }
  return Math.max(0, drawSize - (totalPlayers || 0));
};

/**
 * Priority-based BYE line placement. BYE #i is placed on the R1-opponent
 * line of Seed #i -- guaranteeing the top seeds get a free first-round pass.
 *
 * Example (drawSize=8, numberOfByes=2):
 *   Seed 1 is at line 1 -> opponent line 2 -> BYE #1.
 *   Seed 2 is at line 8 -> opponent line 7 -> BYE #2.
 *   Returns [2, 7].
 *
 * @param {number} drawSize
 * @param {number} numberOfByes  0..drawSize
 * @returns {number[]} 1-indexed line numbers (sorted ascending).
 */
const getByePositions = (drawSize, numberOfByes) => {
  if (!VALID_DRAW_SIZES.includes(drawSize)) {
    throw new Error(`Invalid drawSize ${drawSize}. Valid: ${VALID_DRAW_SIZES.join(", ")}`);
  }
  if (numberOfByes < 0 || numberOfByes > drawSize) {
    throw new Error(`numberOfByes ${numberOfByes} out of range for drawSize ${drawSize}.`);
  }
  const order = getSeedOrder(drawSize);       // index i -> seed at line (i+1)
  const lineOfSeed = new Map();
  order.forEach((seed, i) => lineOfSeed.set(seed, i + 1));

  const lines = [];
  for (let seed = 1; seed <= numberOfByes; seed++) {
    const seedLine = lineOfSeed.get(seed);
    if (!seedLine) continue;
    // R1 pair lines are (2k-1, 2k). Opponent is the other line in the pair.
    const opponentLine = seedLine % 2 === 1 ? seedLine + 1 : seedLine - 1;
    lines.push(opponentLine);
  }
  return lines.sort((a, b) => a - b);
};

/**
 * Single source of truth for R1 slot placement shared by all three generators
 * (direct knockout, group->knockout, frontend preview).
 *
 * Algorithm (only active when numberOfSeeds > 0 -- sequential fallback is
 * handled by the caller):
 *   1. Seeded players (top-N of `players`) placed at their Mirror & Flip
 *      positions via getSeedOrder.
 *   2. Priority BYEs: BYE #i -> R1 opponent line of Seed #i.
 *      priorityCount = min(numberOfByes, numberOfSeeds).
 *   3. Remaining BYEs (numberOfByes - priorityCount) placed randomly in the
 *      remaining unseeded slots.
 *   4. Remaining players (after the top-N seeded) shuffled into the leftover
 *      unseeded slots.
 *
 * @param {Object}   opts
 * @param {number}   opts.drawSize
 * @param {number}   opts.numberOfSeeds  0..drawSize.
 * @param {Array}    opts.players        Players in rank order (seeded first).
 * @param {Function} [opts.shuffle]      Optional shuffle impl (useful for tests).
 * @returns {{ slots: Array<object|null>, byeLines: number[] }}
 *          slots: 0-indexed, length=drawSize. Each slot is either a player
 *                 object (with `seed: number|null` added) or null (= BYE).
 *          byeLines: 1-indexed line numbers that are BYEs, sorted ascending.
 */
const buildR1SlotAssignment = ({ drawSize, numberOfSeeds, players, shuffle }) => {
  if (!VALID_DRAW_SIZES.includes(drawSize)) {
    throw new Error(`Invalid drawSize ${drawSize}.`);
  }
  if (!Array.isArray(players)) {
    throw new Error(`players must be an array.`);
  }
  const playerCount = players.length;
  const seedCount = Math.max(0, Math.min(numberOfSeeds || 0, playerCount));
  const numberOfByes = calculateByes(playerCount, drawSize);

  const rand = typeof shuffle === "function"
    ? shuffle
    : (arr) => [...arr].sort(() => Math.random() - 0.5);

  const seedOrder = getSeedOrder(drawSize);
  const slots = new Array(drawSize).fill(null);

  // 1. Seeded players at their Mirror & Flip slots
  for (let i = 0; i < seedCount; i++) {
    const seedNum = i + 1;
    const idx = seedOrder.indexOf(seedNum);
    if (idx >= 0) slots[idx] = { ...players[i], seed: seedNum };
  }

  // 2. Priority BYEs at opponent lines of top seeds
  const priorityCount = Math.min(numberOfByes, seedCount);
  const priorityByeLines = getByePositions(drawSize, priorityCount);
  const byeSlotIdxs = new Set(priorityByeLines.map((line) => line - 1));

  // 3. Remaining unseeded slots (not holding a seed, not already a priority BYE)
  const unseededSlotIdxs = [];
  for (let i = 0; i < drawSize; i++) {
    if (slots[i] == null && !byeSlotIdxs.has(i)) unseededSlotIdxs.push(i);
  }

  const shuffledUnseeded = rand(unseededSlotIdxs);
  const extraByes = Math.max(0, numberOfByes - priorityCount);
  for (let i = 0; i < extraByes && i < shuffledUnseeded.length; i++) {
    byeSlotIdxs.add(shuffledUnseeded[i]);
  }

  // 4. Fill the still-empty unseeded slots with shuffled unseeded pool
  const unseededPool = rand(players.slice(seedCount));
  const remainingUnseededSlots = shuffledUnseeded.slice(extraByes);
  for (let i = 0; i < unseededPool.length && i < remainingUnseededSlots.length; i++) {
    const slotIdx = remainingUnseededSlots[i];
    slots[slotIdx] = { ...unseededPool[i], seed: null };
  }

  const byeLines = [...byeSlotIdxs].sort((a, b) => a - b).map((i) => i + 1);
  return { slots, byeLines };
};

module.exports = {
  getSeedOrder,
  generateSeedPositions,
  getValidDrawSizes,
  getMaxSeeds,
  calculateByes,
  getByePositions,
  buildR1SlotAssignment,
};
