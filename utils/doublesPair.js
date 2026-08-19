/**
 * Doubles pair naming — the single place that decides how two players become
 * one entrant.
 *
 * A doubles entry is ONE entrant made of two people. The platform represents
 * it as a single name string joined by " & " ("Rahul & Amit"), because every
 * downstream consumer — group standings rows, the knockout bracket renderer,
 * the PDF export — treats an entrant as one name. Nothing downstream carries a
 * second playerId.
 *
 * The same pair can legitimately be entered either way round, so comparisons
 * go through pairKey(), which sorts the halves. Without that, "Rahul & Amit"
 * and "Amit & Rahul" are two entrants and the pair enters the draw twice.
 *
 * This logic previously existed twice — BookingController's local nameKey() and
 * entryKey() in sports_app/src/Manager/bulkParse.js — and the two had to be
 * kept in step by hand.
 */

const SEPARATOR = " & ";

/** Normalize one person's name for comparison: trimmed, lowercased, single-spaced. */
const normalizeName = (raw) =>
  String(raw == null ? "" : raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Split an entrant name into its halves. A singles entrant yields one.
 * Splits on "&" so it also reads names typed without the surrounding spaces.
 */
const splitPair = (raw) =>
  String(raw == null ? "" : raw)
    .split("&")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Comparison key for an entrant name, order-insensitive for pairs.
 * "Rahul & Amit" and "amit  &  rahul" both key to "amit & rahul".
 */
const pairKey = (raw) => {
  const parts = splitPair(raw).map(normalizeName).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return parts.sort().join(SEPARATOR);
};

/**
 * Build the entrant name for a doubles pair. Returns the lone name unchanged
 * when there is no partner, so callers can use it for singles too.
 */
const pairDisplayName = (playerName, partnerName) => {
  const a = String(playerName == null ? "" : playerName).trim();
  const b = String(partnerName == null ? "" : partnerName).trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}${SEPARATOR}${b}`;
};

/** Is this the same pair, whichever order each was entered in? */
const isSamePair = (a, b) => {
  const ka = pairKey(a);
  const kb = pairKey(b);
  return !!ka && ka === kb;
};

/**
 * Every individual named by an entrant, normalized. Used by the registration
 * restriction: a person may appear only once in a category, whether they
 * entered it themselves or were named as somebody's partner.
 */
const namesInEntry = (raw) => splitPair(raw).map(normalizeName).filter(Boolean);

module.exports = {
  SEPARATOR,
  normalizeName,
  splitPair,
  pairKey,
  pairDisplayName,
  isSamePair,
  namesInEntry,
};
