// utils/miniAIMapper.js
const stringSimilarity = require("string-similarity");

const synonymMap = {
  name: ["name", "username", "fullname", "playername"],
  email: ["email", "emailid", "mail"],
  mobile: ["mobile", "phone", "phoneno", "contact"],
  password: ["password", "pwd", "pass"],
  role: ["role", "usertype", "designation"],
  playerId: ["playerid", "userid", "user_id"],
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

function miniAIMatch(entryKeys, schemaFields) {
  const mappedFields = {};

  for (let fileKey of entryKeys) {
    const originalKey = fileKey;
    const cleanKey = fileKey.trim().toLowerCase().replace(/[^a-z]/g, "");

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

module.exports = { miniAIMatch };
