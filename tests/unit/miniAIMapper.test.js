"use strict";
/**
 * Spreadsheet column matching for the bulk user import.
 *
 * The bug this pins: headers routinely carry a format hint —
 * "DOB (DD/MM/YYYY)". The matcher strips non-letters, which GLUED the hint to
 * the name ("dobddmmyyyy"). That matched no synonym and scored below the
 * similarity threshold, so the column went unmapped and EVERY row failed as
 * "Missing required value: dateOfBirth" — 218 of 218 on a real import, with
 * nothing in the response pointing at the header.
 *
 * The previous fix hardcoded one spelling ("dateofbirthddmmyyyy") into the
 * synonym list, which only covered the single file it was found on. These
 * assertions cover the shapes an operator actually produces.
 */
const { miniAIMatch, normalizeHeader } = require("../../utils/miniAIMapper");

// The subset of User schema fields the importer maps onto.
const SCHEMA_FIELDS = ["name", "email", "mobile", "password", "dateOfBirth", "sex", "age", "role"];

const mapOne = (header) => miniAIMatch([header], SCHEMA_FIELDS)[header] || null;

describe("date of birth headers", () => {
  test.each([
    "dateOfBirth",
    "date of birth",
    "Date of Birth",
    "Date_of_Birth",
    "date-of-birth",
    "DOB",
    "dob",
    "D.O.B.",
    "Birth Date",
    "birthdate",
    "birthday",
  ])("plain header %s maps to dateOfBirth", (header) => {
    expect(mapOne(header)).toBe("dateOfBirth");
  });

  test.each([
    "Date of Birth (DD/MM/YYYY)",
    "DOB (DD/MM/YYYY)",
    "DOB(DD-MM-YYYY)",
    "Date of Birth [YYYY-MM-DD]",
    "DateOfBirth(YYYY-MM-DD)",
    "DOB {DD/MM/YYYY}",
    "Date of Birth *",
  ])("header carrying a format hint %s still maps", (header) => {
    expect(mapOne(header)).toBe("dateOfBirth");
  });

  test("a hint written without brackets is stripped too", () => {
    expect(mapOne("Date of Birth DDMMYYYY")).toBe("dateOfBirth");
    expect(mapOne("DOB YYYYMMDD")).toBe("dateOfBirth");
  });
});

describe("hints are stripped from other columns too", () => {
  test.each([
    ["Email (work)", "email"],
    ["Mobile (10 digits)", "mobile"],
    ["Password (min 8 chars)", "password"],
    ["Player Name", "name"],
  ])("%s maps to %s", (header, expected) => {
    expect(mapOne(header)).toBe(expected);
  });
});

describe("what must NOT map", () => {
  test("a birth YEAR is not a date of birth", () => {
    // Mapping this would fabricate a precise DOB from a year, and DOB drives
    // the age gate — so leaving it unmatched is the safe outcome.
    expect(mapOne("Birth Year")).toBeNull();
  });

  test("a bare format hint is not a column name", () => {
    expect(mapOne("DD/MM/YYYY")).toBeNull();
  });

  test("an unrelated column stays unmapped", () => {
    expect(mapOne("Jersey Number")).toBeNull();
  });
});

describe("normalizeHeader", () => {
  test.each([
    ["DOB (DD/MM/YYYY)", "dob"],
    ["Date of Birth [YYYY-MM-DD]", "dateofbirth"],
    ["  Date of Birth  ", "dateofbirth"],
    ["DateOfBirth(YYYY-MM-DD)", "dateofbirth"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });

  test("a header that is ONLY a hint does not collapse to empty", () => {
    // Guard against the stripped form eating the whole key, which would make
    // every such column map to the same empty string.
    expect(normalizeHeader("DDMMYYYY")).toBe("ddmmyyyy");
  });

  test.each([null, undefined, ""])("%s is handled without throwing", (input) => {
    expect(normalizeHeader(input)).toBe("");
  });
});

describe("a full realistic header row maps end to end", () => {
  test("every required column resolves", () => {
    const headers = [
      "Player Name",
      "Email Account",
      "Mobile",
      "Password",
      "DOB (DD/MM/YYYY)",
      "Sex",
    ];
    const mapped = miniAIMatch(headers, SCHEMA_FIELDS);
    expect(Object.values(mapped).sort()).toEqual(
      ["dateOfBirth", "email", "mobile", "name", "password", "sex"].sort()
    );
  });
});
