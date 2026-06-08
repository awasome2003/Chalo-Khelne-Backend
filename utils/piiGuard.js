// Detect obvious personal information (phone numbers, email addresses) in free
// text. Used to stop MINORS from sharing PII in chat without adult action
// (Families Policy req #3). Heuristic by design — it errs toward catching
// structured PII (emails, long digit runs) rather than every possible case.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// A run of 7+ digits (optionally separated by spaces / dashes / dots / parens)
// looks like a phone number.
const PHONE_RE = /(?:\d[\s().-]?){7,}/;

function containsPII(text) {
  if (!text || typeof text !== "string") return false;
  if (EMAIL_RE.test(text)) return true;
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount >= 7 && PHONE_RE.test(text)) return true;
  return false;
}

module.exports = { containsPII };
