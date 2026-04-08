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
const { getScoringType } = require("../utils/matchFormatUtils");
const { readMatchResult } = require("../utils/matchUtils");

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// SPORT-AWARE SCORE EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect CSV format from columns and extract scores accordingly.
 * Returns: { scoringType, player1Score, player2Score, details, sets }
 */
function extractScores(row, scoringType) {
  // ── SETS-BASED (TT, Badminton, Tennis, etc.) ──
  if (scoringType === "sets" || (!scoringType && row.set1_p1 !== undefined)) {
    return extractSetScores(row);
  }

  // ── TIME-BASED (Football, Basketball, etc.) ──
  if (scoringType === "time" || row.score_p1 !== undefined || row.goals_p1 !== undefined) {
    return extractTimeScores(row);
  }

  // ── INNINGS-BASED (Cricket) ──
  if (scoringType === "innings" || row.runs_p1 !== undefined) {
    return extractInningsScores(row);
  }

  // ── SINGLE-RESULT (Chess, Carrom) ──
  if (scoringType === "single" || row.result !== undefined) {
    return extractSingleResult(row);
  }

  // Fallback: try set-based parsing (backward compat)
  if (row.set1_p1 !== undefined) {
    return extractSetScores(row);
  }

  throw new Error(`Cannot determine score format. scoringType=${scoringType}. Provide set columns (set1_p1), score columns (score_p1), runs columns (runs_p1), or result column.`);
}

/**
 * Extract set-based scores (TT, Badminton, Tennis, Volleyball).
 * CSV columns: set1_p1, set1_p2, set2_p1, set2_p2, ...
 */
function extractSetScores(row) {
  const sets = [];
  for (let i = 1; i <= 7; i++) {
    const p1 = row[`set${i}_p1`];
    const p2 = row[`set${i}_p2`];
    if (p1 === undefined || p2 === undefined || p1 === "" || p2 === "") break;

    const p1Score = parseInt(p1, 10);
    const p2Score = parseInt(p2, 10);

    if (isNaN(p1Score) || isNaN(p2Score)) throw new Error(`Set ${i}: scores must be numeric (got "${p1}" vs "${p2}")`);
    if (p1Score < 0 || p2Score < 0) throw new Error(`Set ${i}: scores cannot be negative`);
    if (p1Score === p2Score) throw new Error(`Set ${i}: scores cannot be tied (${p1Score}-${p2Score})`);

    sets.push({ player1Score: p1Score, player2Score: p2Score });
  }

  if (sets.length === 0) throw new Error("No set scores found. Expected columns: set1_p1, set1_p2, ...");

  let p1Wins = 0, p2Wins = 0;
  sets.forEach(s => { if (s.player1Score > s.player2Score) p1Wins++; else p2Wins++; });

  return {
    scoringType: "sets",
    player1Score: p1Wins,
    player2Score: p2Wins,
    winner: p1Wins > p2Wins ? "player1" : "player2",
    details: sets,
    sets, // raw sets for legacy storage
  };
}

/**
 * Extract time-based scores (Football, Basketball, Hockey).
 * CSV columns: score_p1, score_p2 (or goals_p1, goals_p2)
 */
function extractTimeScores(row) {
  const p1 = parseInt(row.score_p1 || row.goals_p1, 10);
  const p2 = parseInt(row.score_p2 || row.goals_p2, 10);

  if (isNaN(p1) || isNaN(p2)) throw new Error(`Time score: must be numeric (got "${row.score_p1 || row.goals_p1}" vs "${row.score_p2 || row.goals_p2}")`);
  if (p1 < 0 || p2 < 0) throw new Error("Time score: cannot be negative");

  return {
    scoringType: "time",
    player1Score: p1 > p2 ? 1 : (p2 > p1 ? 0 : 0),
    player2Score: p2 > p1 ? 1 : (p1 > p2 ? 0 : 0),
    winner: p1 > p2 ? "player1" : (p2 > p1 ? "player2" : null),
    details: [{ player1Score: p1, player2Score: p2 }],
    sets: null, // will create 1 set with 1 game
    rawScores: { p1, p2 },
  };
}

/**
 * Extract innings-based scores (Cricket).
 * CSV columns: runs_p1, runs_p2 (optional: wickets_p1, wickets_p2, overs_p1, overs_p2)
 */
function extractInningsScores(row) {
  const p1Runs = parseInt(row.runs_p1, 10);
  const p2Runs = parseInt(row.runs_p2, 10);

  if (isNaN(p1Runs) || isNaN(p2Runs)) throw new Error(`Innings score: runs must be numeric (got "${row.runs_p1}" vs "${row.runs_p2}")`);
  if (p1Runs < 0 || p2Runs < 0) throw new Error("Innings score: cannot be negative");

  const p1Wickets = parseInt(row.wickets_p1) || 0;
  const p2Wickets = parseInt(row.wickets_p2) || 0;

  return {
    scoringType: "innings",
    player1Score: p1Runs > p2Runs ? 1 : (p2Runs > p1Runs ? 0 : 0),
    player2Score: p2Runs > p1Runs ? 1 : (p1Runs > p2Runs ? 0 : 0),
    winner: p1Runs > p2Runs ? "player1" : (p2Runs > p1Runs ? "player2" : null),
    details: [{ player1Score: p1Runs, player2Score: p2Runs, player1Wickets: p1Wickets, player2Wickets: p2Wickets }],
    sets: null,
    rawScores: { p1: p1Runs, p2: p2Runs },
  };
}

/**
 * Extract single-result scores (Chess, Carrom).
 * CSV column: result ("1-0", "0-1", "draw", "0.5-0.5")
 */
function extractSingleResult(row) {
  const result = (row.result || "").trim().toLowerCase();
  const VALID = { "1-0": "player1", "0-1": "player2", "draw": null, "0.5-0.5": null };

  if (!VALID.hasOwnProperty(result)) {
    throw new Error(`Invalid result "${result}". Must be: 1-0, 0-1, draw, or 0.5-0.5`);
  }

  const winner = VALID[result];
  return {
    scoringType: "single",
    player1Score: winner === "player1" ? 1 : 0,
    player2Score: winner === "player2" ? 1 : 0,
    winner,
    details: [{ result }],
    sets: null,
    rawScores: { result },
  };
}

/**
 * Validate winner determination for set-based sports.
 */
function validateSetWinner(sets, setsToWin) {
  let p1Wins = 0, p2Wins = 0;
  for (const s of sets) {
    if (s.player1Score > s.player2Score) p1Wins++;
    else p2Wins++;
  }

  if (p1Wins < setsToWin && p2Wins < setsToWin) {
    return { valid: false, error: `Not enough sets to determine winner. Need ${setsToWin}, got ${p1Wins}-${p2Wins}` };
  }

  return { valid: true, p1Wins, p2Wins, winner: p1Wins >= setsToWin ? "player1" : "player2" };
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL MATCH BULK UPLOAD (SuperMatch / Group Stage)
// ═══════════════════════════════════════════════════════════════

async function processPlayerMatch(matchId, scoreData, rowIndex) {
  const match = await SuperMatch.findById(matchId);
  if (!match) return { row: rowIndex, error: `Match ${matchId} not found` };
  if (match.status === "COMPLETED") return { row: rowIndex, error: `Match ${matchId} already completed`, skipped: true };
  if (!match.matchFormat) return { row: rowIndex, error: `Match ${matchId} has no format configuration` };

  const scoringType = scoreData.scoringType;

  if (scoringType === "sets") {
    // Set-based: validate winner
    const maxSets = match.matchFormat.maxSets || match.matchFormat.totalSets || 5;
    const setsToWin = match.matchFormat.setsToWin || Math.ceil(maxSets / 2);
    const validation = validateSetWinner(scoreData.sets, setsToWin);
    if (!validation.valid) return { row: rowIndex, error: validation.error };
  }

  // Build the internal sets/games structure (legacy storage format)
  const matchSets = [];
  if (scoreData.sets) {
    // Set-based
    let p1SetsWon = 0, p2SetsWon = 0;
    for (const setScore of scoreData.sets) {
      const isP1Winner = setScore.player1Score > setScore.player2Score;
      if (isP1Winner) p1SetsWon++; else p2SetsWon++;

      const winnerData = isP1Winner
        ? { playerId: match.player1?.playerId, playerName: match.player1?.playerName }
        : { playerId: match.player2?.playerId, playerName: match.player2?.playerName };

      matchSets.push({
        setNumber: matchSets.length + 1,
        status: "COMPLETED",
        winner: winnerData,
        games: [{ gameNumber: 1, status: "COMPLETED", finalScore: { player1: setScore.player1Score, player2: setScore.player2Score }, winner: winnerData, startTime: new Date(), endTime: new Date() }],
      });
    }
  } else {
    // Non-set: store as 1 set with 1 game
    const p1 = scoreData.rawScores?.p1 ?? scoreData.player1Score;
    const p2 = scoreData.rawScores?.p2 ?? scoreData.player2Score;
    const winnerSide = scoreData.winner;
    const winnerData = winnerSide === "player1"
      ? { playerId: match.player1?.playerId, playerName: match.player1?.playerName }
      : winnerSide === "player2"
      ? { playerId: match.player2?.playerId, playerName: match.player2?.playerName }
      : { playerId: null, playerName: null };

    matchSets.push({
      setNumber: 1,
      status: "COMPLETED",
      winner: winnerData,
      games: [{ gameNumber: 1, status: "COMPLETED", finalScore: { player1: p1, player2: p2 }, winner: winnerData, startTime: new Date(), endTime: new Date() }],
    });
  }

  const matchWinner = scoreData.winner === "player1"
    ? { playerId: match.player1?.playerId, playerName: match.player1?.playerName }
    : scoreData.winner === "player2"
    ? { playerId: match.player2?.playerId, playerName: match.player2?.playerName }
    : { playerId: null, playerName: "draw" };

  // Write to match
  match.sets = matchSets;
  match.status = "COMPLETED";
  match.currentSet = matchSets.length;
  match.currentGame = 1;
  match.liveScore = { player1Points: 0, player2Points: 0 };
  match.result = {
    winner: matchWinner,
    finalScore: { player1Sets: scoreData.player1Score, player2Sets: scoreData.player2Score },
    matchDuration: 0,
    completedAt: new Date(),
  };
  match.winner = matchWinner;

  // Write normalized matchResult
  match.matchResult = {
    type: scoringType,
    completed: true,
    player1Score: scoreData.player1Score,
    player2Score: scoreData.player2Score,
    winner: matchWinner,
    details: scoreData.details,
  };

  await match.save();

  return {
    row: rowIndex,
    matchId: matchId.toString(),
    player1: match.player1?.playerName || "P1",
    player2: match.player2?.playerName || "P2",
    winner: matchWinner.playerName,
    finalScore: `${scoreData.player1Score}-${scoreData.player2Score}`,
    scoringType,
    status: "success",
  };
}

// ═══════════════════════════════════════════════════════════════
// TEAM KNOCKOUT BULK UPLOAD
// ═══════════════════════════════════════════════════════════════

async function processTeamMatch(matchId, scoreData, rowIndex) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const match = await TeamKnockoutMatches.findById(matchId).session(session);
    if (!match) { await session.abortTransaction(); session.endSession(); return { row: rowIndex, error: `Match ${matchId} not found` }; }
    if (match.status === "COMPLETED") { await session.abortTransaction(); session.endSession(); return { row: rowIndex, error: `Match ${matchId} already completed`, skipped: true }; }
    if (match.isBye) { await session.abortTransaction(); session.endSession(); return { row: rowIndex, error: `Match ${matchId} is a BYE match`, skipped: true }; }

    if (scoreData.scoringType !== "sets" || !scoreData.sets) {
      await session.abortTransaction(); session.endSession();
      return { row: rowIndex, error: `Team knockout currently only supports set-based CSV. Got: ${scoreData.scoringType}` };
    }

    const setsNeeded = match.format?.includes("5") ? 3 : 2;
    const validation = validateSetWinner(scoreData.sets, setsNeeded);
    if (!validation.valid) { await session.abortTransaction(); session.endSession(); return { row: rowIndex, error: validation.error }; }

    let homeSetsWon = 0, awaySetsWon = 0, done = false;

    for (let i = 0; i < scoreData.sets.length && !done; i++) {
      const setScore = scoreData.sets[i];
      if (i >= match.sets.length) break;

      const currentSet = match.sets[i];
      const gameWinner = setScore.player1Score > setScore.player2Score ? "home" : "away";

      currentSet.games = [{ gameNumber: 1, homePoints: setScore.player1Score, awayPoints: setScore.player2Score, winner: gameWinner, status: "COMPLETED", startTime: new Date(), endTime: new Date() }];
      currentSet.gamesWon = { home: gameWinner === "home" ? 1 : 0, away: gameWinner === "away" ? 1 : 0 };
      currentSet.setWinner = gameWinner;
      currentSet.status = "COMPLETED";

      if (gameWinner === "home") homeSetsWon++; else awaySetsWon++;
      if (homeSetsWon >= setsNeeded || awaySetsWon >= setsNeeded) done = true;
    }

    match.setsWon = { home: homeSetsWon, away: awaySetsWon };
    match.matchWinner = homeSetsWon >= setsNeeded ? "home" : "away";
    match.winnerId = match.matchWinner === "home" ? match.team1Id : match.team2Id;
    match.status = "COMPLETED";
    match.completedAt = new Date();

    // Normalized matchResult
    match.matchResult = {
      type: "sets",
      completed: true,
      player1Score: homeSetsWon,
      player2Score: awaySetsWon,
      winner: { playerId: match.winnerId, playerName: null, isTeam: true },
      details: scoreData.details,
    };

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
      scoringType: "sets",
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
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

      filePath = req.file.path;
      const { tournamentId, matchType = "player" } = req.body;
      if (!tournamentId) return res.status(400).json({ success: false, message: "tournamentId is required" });

      // Detect tournament sport for scoring type
      const tournament = await Tournament.findById(tournamentId).select("sportsType matchFormat").lean();
      const scoringType = tournament?.matchFormat?.scoringType || getScoringType(tournament?.sportsType) || null;

      let rows;
      try { rows = await parseFile(filePath, req.file.originalname); }
      catch (parseErr) { return res.status(400).json({ success: false, message: parseErr.message }); }

      if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "File is empty or has no valid rows" });

      // Validate required columns
      const firstRow = rows[0];
      if (!firstRow.match_id) {
        return res.status(400).json({
          success: false,
          message: `Missing required column: match_id. Expected format depends on sport type (${scoringType || "unknown"}).`,
          columns_found: Object.keys(firstRow),
          hints: {
            sets: "match_id, set1_p1, set1_p2, set2_p1, set2_p2, ...",
            time: "match_id, score_p1, score_p2",
            innings: "match_id, runs_p1, runs_p2",
            single: "match_id, result",
          },
        });
      }

      const results = [];
      const errors = [];
      const duplicateCheck = new Set();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        try {
          const matchId = row.match_id;
          if (!matchId) { errors.push({ row: rowNum, error: "Empty match_id" }); continue; }
          if (!mongoose.Types.ObjectId.isValid(matchId)) { errors.push({ row: rowNum, error: `Invalid match_id: ${matchId}` }); continue; }
          if (duplicateCheck.has(matchId)) { errors.push({ row: rowNum, error: `Duplicate match_id: ${matchId}` }); continue; }
          duplicateCheck.add(matchId);

          // Sport-aware score extraction
          let scoreData;
          try { scoreData = extractScores(row, scoringType); }
          catch (scoreErr) { errors.push({ row: rowNum, match_id: matchId, error: scoreErr.message }); continue; }

          let result;
          if (matchType === "team") {
            result = await processTeamMatch(matchId, scoreData, rowNum);
          } else {
            result = await processPlayerMatch(matchId, scoreData, rowNum);
          }

          if (result.error) errors.push(result);
          else results.push(result);
        } catch (rowErr) {
          errors.push({ row: rowNum, error: rowErr.message });
        }
      }

      res.json({
        success: true,
        message: `Processed ${rows.length} rows: ${results.length} succeeded, ${errors.length} failed`,
        scoringType: scoringType || "auto-detected",
        summary: { totalRows: rows.length, succeeded: results.length, failed: errors.length, skipped: errors.filter(e => e.skipped).length },
        results,
        errors,
      });
    } catch (err) {
      console.error("[BULK_RESULT_UPLOAD] Error:", err);
      res.status(500).json({ success: false, message: err.message });
    } finally {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  },

  /**
   * POST /api/tournaments/bulk-result-upload/preview
   */
  previewFile: async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

      filePath = req.file.path;
      const scoringType = req.body.scoringType || null;
      const rows = await parseFile(filePath, req.file.originalname);

      if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "File is empty" });

      const columns = Object.keys(rows[0]);
      const preview = rows.slice(0, 10);

      const validationResults = preview.map((row, i) => {
        const issues = [];
        if (!row.match_id) issues.push("Missing match_id");
        if (!mongoose.Types.ObjectId.isValid(row.match_id || "")) issues.push("Invalid match_id format");

        try { extractScores(row, scoringType); }
        catch (e) { issues.push(e.message); }

        return { row: i + 2, data: row, valid: issues.length === 0, issues };
      });

      res.json({ success: true, totalRows: rows.length, columns, preview: validationResults });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    } finally {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  },

  /**
   * GET /api/tournaments/bulk-result-upload/template?type=player&sport=football
   */
  downloadTemplate: (req, res) => {
    const matchType = req.query.type || "player";
    const sport = (req.query.sport || "").toLowerCase();
    const scoringType = getScoringType(sport) || "sets";

    let csvContent;
    if (scoringType === "time") {
      csvContent = [
        "match_id,score_p1,score_p2",
        "PASTE_MATCH_ID_HERE,3,1",
        "PASTE_MATCH_ID_HERE,2,2",
      ].join("\n");
    } else if (scoringType === "innings") {
      csvContent = [
        "match_id,runs_p1,wickets_p1,runs_p2,wickets_p2",
        "PASTE_MATCH_ID_HERE,150,8,145,10",
        "PASTE_MATCH_ID_HERE,200,5,180,10",
      ].join("\n");
    } else if (scoringType === "single") {
      csvContent = [
        "match_id,result",
        "PASTE_MATCH_ID_HERE,1-0",
        "PASTE_MATCH_ID_HERE,0-1",
        "PASTE_MATCH_ID_HERE,draw",
      ].join("\n");
    } else {
      // Sets-based (default)
      const setColumns = matchType === "team"
        ? "match_id,team1_name,team2_name,set1_p1,set1_p2,set2_p1,set2_p2,set3_p1,set3_p2,set4_p1,set4_p2,set5_p1,set5_p2"
        : "match_id,player1_name,player2_name,set1_p1,set1_p2,set2_p1,set2_p2,set3_p1,set3_p2,set4_p1,set4_p2,set5_p1,set5_p2";
      csvContent = [setColumns, "PASTE_MATCH_ID_HERE,Name1,Name2,21,18,15,21,21,17,,,,,"].join("\n");
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=bulk_template_${scoringType}.csv`);
    res.send(csvContent);
  },
};

module.exports = bulkResultUploadController;
