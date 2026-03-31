const xlsx = require("xlsx");
const csvtojson = require("csvtojson");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

// Models
const SuperMatch = require("../Modal/SuperMatch");
const TeamKnockoutMatches = require("../Modal/TeamKnockoutMatches");
const TeamKnockoutTeams = require("../Modal/TeamKnockoutTeams");
const Tournament = require("../Modal/Tournament");

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Parse uploaded file (CSV or XLSX) into a uniform array of row objects.
 * Column headers are normalized to lowercase + trimmed.
 */
async function parseFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".csv") {
    const rows = await csvtojson().fromFile(filePath);
    return rows.map(normalizeRow);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    return rows.map(normalizeRow);
  }

  throw new Error(`Unsupported file format: ${ext}. Use .csv or .xlsx`);
}

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.trim().toLowerCase().replace(/\s+/g, "_")] = typeof value === "string" ? value.trim() : value;
  }
  return normalized;
}

/**
 * Extract set scores from a row.
 * Supports columns: set1_p1, set1_p2, set2_p1, set2_p2, ... (up to 7 sets)
 */
function extractSets(row) {
  const sets = [];
  for (let i = 1; i <= 7; i++) {
    const p1Key = `set${i}_p1`;
    const p2Key = `set${i}_p2`;
    const p1 = row[p1Key];
    const p2 = row[p2Key];

    if (p1 === undefined || p2 === undefined || p1 === "" || p2 === "") break;

    const p1Score = parseInt(p1, 10);
    const p2Score = parseInt(p2, 10);

    if (isNaN(p1Score) || isNaN(p2Score)) {
      throw new Error(`Set ${i}: scores must be numeric (got "${p1}" vs "${p2}")`);
    }
    if (p1Score < 0 || p2Score < 0) {
      throw new Error(`Set ${i}: scores cannot be negative`);
    }
    if (p1Score === p2Score) {
      throw new Error(`Set ${i}: scores cannot be tied (${p1Score}-${p2Score})`);
    }

    sets.push({ player1Score: p1Score, player2Score: p2Score });
  }
  return sets;
}

/**
 * Validate that enough sets are filled to determine a winner.
 */
function validateWinner(sets, setsToWin) {
  let p1Wins = 0, p2Wins = 0;
  for (const s of sets) {
    if (s.player1Score > s.player2Score) p1Wins++;
    else p2Wins++;
  }

  if (p1Wins < setsToWin && p2Wins < setsToWin) {
    return { valid: false, error: `Not enough sets to determine winner. Need ${setsToWin}, got ${p1Wins}-${p2Wins}` };
  }

  return {
    valid: true,
    p1Wins,
    p2Wins,
    winner: p1Wins >= setsToWin ? "player1" : "player2",
  };
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL MATCH BULK UPLOAD (SuperMatch / Group Stage)
// ═══════════════════════════════════════════════════════════════

async function processPlayerMatch(matchId, sets, rowIndex) {
  const match = await SuperMatch.findById(matchId);
  if (!match) return { row: rowIndex, error: `Match ${matchId} not found` };
  if (match.status === "COMPLETED") return { row: rowIndex, error: `Match ${matchId} already completed`, skipped: true };

  if (!match.matchFormat) return { row: rowIndex, error: `Match ${matchId} has no format configuration` };
  const maxSets = match.matchFormat.maxSets || match.matchFormat.totalSets || 5;
  const setsToWin = match.matchFormat.setsToWin || Math.ceil(maxSets / 2);

  const validation = validateWinner(sets, setsToWin);
  if (!validation.valid) return { row: rowIndex, error: validation.error };

  // Build sets array
  const matchSets = [];
  let p1SetsWon = 0, p2SetsWon = 0;
  let done = false;

  for (let i = 0; i < sets.length && !done; i++) {
    const setScore = sets[i];
    const isP1Winner = setScore.player1Score > setScore.player2Score;
    if (isP1Winner) p1SetsWon++;
    else p2SetsWon++;

    const winnerData = isP1Winner
      ? { playerId: match.player1?.playerId, playerName: match.player1?.playerName }
      : { playerId: match.player2?.playerId, playerName: match.player2?.playerName };

    matchSets.push({
      setNumber: i + 1,
      status: "COMPLETED",
      winner: winnerData,
      games: [{
        gameNumber: 1,
        status: "COMPLETED",
        finalScore: {
          player1: setScore.player1Score,
          player2: setScore.player2Score,
        },
        winner: winnerData,
        startTime: new Date(),
        endTime: new Date(),
      }],
    });

    if (p1SetsWon >= setsToWin || p2SetsWon >= setsToWin) done = true;
  }

  const matchWinner = p1SetsWon >= setsToWin ? "player1" : "player2";
  const winnerObj = matchWinner === "player1"
    ? { playerId: match.player1?.playerId, playerName: match.player1?.playerName }
    : { playerId: match.player2?.playerId, playerName: match.player2?.playerName };

  match.sets = matchSets;
  match.status = "COMPLETED";
  match.currentSet = matchSets.length;
  match.currentGame = 1;
  match.liveScore = { player1Points: 0, player2Points: 0 };
  match.result = {
    winner: winnerObj,
    finalScore: { player1Sets: p1SetsWon, player2Sets: p2SetsWon },
    matchDuration: 0,
    completedAt: new Date(),
  };
  match.winner = winnerObj;

  await match.save();

  return {
    row: rowIndex,
    matchId: matchId.toString(),
    player1: match.player1?.playerName || "P1",
    player2: match.player2?.playerName || "P2",
    winner: winnerObj.playerName,
    finalScore: `${p1SetsWon}-${p2SetsWon}`,
    status: "success",
  };
}

// ═══════════════════════════════════════════════════════════════
// TEAM KNOCKOUT BULK UPLOAD
// ═══════════════════════════════════════════════════════════════

async function processTeamMatch(matchId, sets, rowIndex) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const match = await TeamKnockoutMatches.findById(matchId).session(session);
    if (!match) {
      await session.abortTransaction();
      session.endSession();
      return { row: rowIndex, error: `Match ${matchId} not found` };
    }
    if (match.status === "COMPLETED") {
      await session.abortTransaction();
      session.endSession();
      return { row: rowIndex, error: `Match ${matchId} already completed`, skipped: true };
    }
    if (match.isBye) {
      await session.abortTransaction();
      session.endSession();
      return { row: rowIndex, error: `Match ${matchId} is a BYE match`, skipped: true };
    }

    const setsNeeded = match.format?.includes("5") ? 3 : 2;

    const validation = validateWinner(sets, setsNeeded);
    if (!validation.valid) {
      await session.abortTransaction();
      session.endSession();
      return { row: rowIndex, error: validation.error };
    }

    let homeSetsWon = 0, awaySetsWon = 0;
    let done = false;

    for (let i = 0; i < sets.length && !done; i++) {
      const setScore = sets[i];
      const setIdx = i;
      if (setIdx >= match.sets.length) break;

      const currentSet = match.sets[setIdx];
      const gameWinner = setScore.player1Score > setScore.player2Score ? "home" : "away";

      currentSet.games = [{
        gameNumber: 1,
        homePoints: setScore.player1Score,
        awayPoints: setScore.player2Score,
        winner: gameWinner,
        status: "COMPLETED",
        startTime: new Date(),
        endTime: new Date(),
      }];
      currentSet.gamesWon = { home: gameWinner === "home" ? 1 : 0, away: gameWinner === "away" ? 1 : 0 };
      currentSet.setWinner = gameWinner;
      currentSet.status = "COMPLETED";

      if (gameWinner === "home") homeSetsWon++;
      else awaySetsWon++;

      if (homeSetsWon >= setsNeeded || awaySetsWon >= setsNeeded) done = true;
    }

    match.setsWon = { home: homeSetsWon, away: awaySetsWon };
    match.matchWinner = homeSetsWon >= setsNeeded ? "home" : "away";
    match.winnerId = match.matchWinner === "home" ? match.team1Id : match.team2Id;
    match.status = "COMPLETED";
    match.completedAt = new Date();

    // Update team stats
    const winnerTeamId = match.matchWinner === "home" ? match.team1Id : match.team2Id;
    const loserTeamId = match.matchWinner === "home" ? match.team2Id : match.team1Id;

    const winnerTeam = await TeamKnockoutTeams.findById(winnerTeamId).session(session);
    const loserTeam = await TeamKnockoutTeams.findById(loserTeamId).session(session);

    if (winnerTeam) {
      winnerTeam.matchesWon += 1;
      winnerTeam.setsWon += match.matchWinner === "home" ? homeSetsWon : awaySetsWon;
      winnerTeam.setsLost += match.matchWinner === "home" ? awaySetsWon : homeSetsWon;
      await winnerTeam.save({ session });
    }
    if (loserTeam) {
      loserTeam.matchesLost += 1;
      loserTeam.status = "ELIMINATED";
      loserTeam.setsWon += match.matchWinner === "home" ? awaySetsWon : homeSetsWon;
      loserTeam.setsLost += match.matchWinner === "home" ? homeSetsWon : awaySetsWon;
      await loserTeam.save({ session });
    }

    await match.save({ session });
    await session.commitTransaction();
    session.endSession();

    const team1 = await TeamKnockoutTeams.findById(match.team1Id);
    const team2 = await TeamKnockoutTeams.findById(match.team2Id);

    return {
      row: rowIndex,
      matchId: matchId.toString(),
      team1: team1?.teamName || "Team 1",
      team2: team2?.teamName || "Team 2",
      winner: match.matchWinner === "home" ? (team1?.teamName || "Team 1") : (team2?.teamName || "Team 2"),
      finalScore: `${homeSetsWon}-${awaySetsWon}`,
      status: "success",
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return { row: rowIndex, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONTROLLER
// ═══════════════════════════════════════════════════════════════

const bulkResultUploadController = {
  /**
   * POST /api/tournaments/bulk-result-upload
   * Body: multipart/form-data { file, tournamentId, matchType: "player"|"team" }
   */
  uploadResults: async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      filePath = req.file.path;
      const { tournamentId, matchType = "player" } = req.body;

      if (!tournamentId) {
        return res.status(400).json({ success: false, message: "tournamentId is required" });
      }

      // Parse file
      let rows;
      try {
        rows = await parseFile(filePath, req.file.originalname);
      } catch (parseErr) {
        return res.status(400).json({ success: false, message: parseErr.message });
      }

      if (!rows || rows.length === 0) {
        return res.status(400).json({ success: false, message: "File is empty or has no valid rows" });
      }

      // Validate required columns
      const firstRow = rows[0];
      if (!firstRow.match_id) {
        return res.status(400).json({
          success: false,
          message: "Missing required column: match_id. Expected columns: match_id, set1_p1, set1_p2, set2_p1, set2_p2, ...",
          columns_found: Object.keys(firstRow),
        });
      }

      const results = [];
      const errors = [];
      const duplicateCheck = new Set();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // +2 because row 1 is header, data starts at row 2

        try {
          // Validate match_id
          const matchId = row.match_id;
          if (!matchId) {
            errors.push({ row: rowNum, error: "Empty match_id" });
            continue;
          }

          if (!mongoose.Types.ObjectId.isValid(matchId)) {
            errors.push({ row: rowNum, error: `Invalid match_id format: ${matchId}` });
            continue;
          }

          // Duplicate check within file
          if (duplicateCheck.has(matchId)) {
            errors.push({ row: rowNum, error: `Duplicate match_id: ${matchId} (already in this file)` });
            continue;
          }
          duplicateCheck.add(matchId);

          // Extract set scores
          let sets;
          try {
            sets = extractSets(row);
          } catch (setErr) {
            errors.push({ row: rowNum, match_id: matchId, error: setErr.message });
            continue;
          }

          if (sets.length === 0) {
            errors.push({ row: rowNum, match_id: matchId, error: "No set scores found. Expected columns: set1_p1, set1_p2, ..." });
            continue;
          }

          // Process based on match type
          let result;
          if (matchType === "team") {
            result = await processTeamMatch(matchId, sets, rowNum);
          } else {
            result = await processPlayerMatch(matchId, sets, rowNum);
          }

          if (result.error) {
            errors.push(result);
          } else {
            results.push(result);
          }
        } catch (rowErr) {
          errors.push({ row: rowNum, error: rowErr.message });
        }
      }

      res.json({
        success: true,
        message: `Processed ${rows.length} rows: ${results.length} succeeded, ${errors.length} failed`,
        summary: {
          totalRows: rows.length,
          succeeded: results.length,
          failed: errors.length,
          skipped: errors.filter((e) => e.skipped).length,
        },
        results,
        errors,
      });
    } catch (err) {
      console.error("[BULK_RESULT_UPLOAD] Error:", err);
      res.status(500).json({ success: false, message: err.message });
    } finally {
      // Clean up uploaded file
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  },

  /**
   * POST /api/tournaments/bulk-result-upload/preview
   * Body: multipart/form-data { file }
   * Returns parsed rows without processing — for frontend preview.
   */
  previewFile: async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      filePath = req.file.path;
      const rows = await parseFile(filePath, req.file.originalname);

      if (!rows || rows.length === 0) {
        return res.status(400).json({ success: false, message: "File is empty" });
      }

      // Return first 10 rows as preview + column info
      const columns = Object.keys(rows[0]);
      const preview = rows.slice(0, 10);
      const hasRequiredCols = columns.includes("match_id") && columns.some((c) => c.startsWith("set1_p"));

      // Validate each preview row
      const validationResults = preview.map((row, i) => {
        const issues = [];
        if (!row.match_id) issues.push("Missing match_id");
        if (!mongoose.Types.ObjectId.isValid(row.match_id || "")) issues.push("Invalid match_id format");

        try {
          const sets = extractSets(row);
          if (sets.length === 0) issues.push("No set scores found");
        } catch (e) {
          issues.push(e.message);
        }

        return { row: i + 2, data: row, valid: issues.length === 0, issues };
      });

      res.json({
        success: true,
        totalRows: rows.length,
        columns,
        hasRequiredColumns: hasRequiredCols,
        preview: validationResults,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  },

  /**
   * GET /api/tournaments/bulk-result-upload/template
   * Downloads a sample CSV template.
   */
  downloadTemplate: (req, res) => {
    const matchType = req.query.type || "player";

    let csvContent;
    if (matchType === "team") {
      csvContent = [
        "match_id,team1_name,team2_name,set1_p1,set1_p2,set2_p1,set2_p2,set3_p1,set3_p2,set4_p1,set4_p2,set5_p1,set5_p2",
        "PASTE_MATCH_ID_HERE,Team Alpha,Team Beta,11,8,9,11,11,7,,,,,",
        "PASTE_MATCH_ID_HERE,Team Gamma,Team Delta,11,5,11,9,,,,,,,",
      ].join("\n");
    } else {
      csvContent = [
        "match_id,player1_name,player2_name,set1_p1,set1_p2,set2_p1,set2_p2,set3_p1,set3_p2,set4_p1,set4_p2,set5_p1,set5_p2",
        "PASTE_MATCH_ID_HERE,John Doe,Jane Smith,11,8,9,11,11,7,,,,,",
        "PASTE_MATCH_ID_HERE,Mike Johnson,Sarah Williams,11,5,11,9,,,,,,,",
      ].join("\n");
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=bulk_result_template_${matchType}.csv`);
    res.send(csvContent);
  },
};

module.exports = bulkResultUploadController;
