// utils/miniAIMapper.js
const stringSimilarity = require("string-similarity");

const synonymMap = {
  name: ["name", "username", "fullname", "playername"],
  email: ["email", "emailid", "mail"],
  mobile: ["mobile", "phone", "phoneno", "contact"],
  password: ["password", "pwd", "pass"],
  role: ["role", "usertype", "designation"],
  playerId: ["playerid", "userid", "user_id"],
  // Required for the age-gated roles (Player/Trainer/Referee). Without these
  // synonyms a "DOB" or "Date of Birth" column does not resolve by string
  // similarity, so every imported row failed schema validation.
  dateOfBirth: ["dateofbirth", "dob", "birthdate", "birthday"],
  sex: ["sex", "gender"],
};

function buildSynonymLookup() {
  const lookup = {};
  for (const key in synonymMap) {
    for (const syn of synonymMap[key]) {
      lookup[syn.toLowerCase().replace(/[^a-z]/g, "")] = key;
    }
  }
  return lookup;
}

const synonymLookup = buildSynonymLookup();


// Spreadsheet headers routinely carry a format hint — "DOB (DD/MM/YYYY)",
// "Date of Birth [YYYY-MM-DD]". Stripping non-letters alone GLUES that hint to
// the name ("dobddmmyyyy"), which then matches no synonym and scores below the
// similarity threshold, so the column silently goes unmapped and every row
// fails as "Missing required value".
//
// The old fix was to hardcode one such spelling ("dateofbirthddmmyyyy") into
// the synonym list; that only covered the one file it was found on. Removing
// the hint is what actually generalises:
//   1. drop anything inside (), [] or {} — that is where hints live;
//   2. drop a trailing date-format token, for hints written without brackets.
const DATE_FORMAT_TOKEN = /(ddmmyyyy|yyyymmdd|mmddyyyy|ddmmyy|mmddyy|ddmonyyyy)$/;

function normalizeHeader(raw) {
  const withoutHints = String(raw == null ? "" : raw).replace(/[([{][^)\]}]*[)\]}]/g, " ");
  const cleaned = withoutHints.trim().toLowerCase().replace(/[^a-z]/g, "");
  const stripped = cleaned.replace(DATE_FORMAT_TOKEN, "");
  // Only use the stripped form when something is left — "ddmmyyyy" on its own
  // is a hint with no column name, and must not collapse to an empty key.
  return stripped.length > 0 ? stripped : cleaned;
}

function miniAIMatch(entryKeys, schemaFields) {
  const mappedFields = {};

  for (let fileKey of entryKeys) {
    const originalKey = fileKey;
    const cleanKey = normalizeHeader(fileKey);

    if (synonymLookup[cleanKey]) {
      mappedFields[originalKey] = synonymLookup[cleanKey];
      continue;
    }

    const bestMatch = stringSimilarity.findBestMatch(cleanKey, schemaFields);
    if (bestMatch.bestMatch.rating > 0.5) {
      mappedFields[originalKey] = bestMatch.bestMatch.target;
    }
  }

  return mappedFields;
}

module.exports = { miniAIMatch, normalizeHeader };
