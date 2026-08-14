const mongoose = require("mongoose");
const DirectKnockoutMatch = require("../src/modules/tournaments/models/DirectKnockoutMatch");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const TopPlayers = require("../src/modules/tournaments/models/TopPlayers");
const BookingGroup = require("../src/modules/tournaments/models/bookinggroup");
const { readMatchFormat } = require("../utils/matchFormatUtils");
const { createKnockoutMatch } = require("../factories/MatchFactory");
const { getSeedOrder, buildR1SlotAssignment } = require("../utils/seedingUtils");
const { shuffle } = require("../utils/shuffle");
const { assertSportInTournament, handleSportContextError } = require("../middleware/requireSportContext");

// In-memory lock to reject duplicate in-flight generate requests for the same
// tournament. Prevents the "frontend timed out, retried, second request's
// deleteMany wiped first request's docs" race that produces DocumentNotFound.
const generationLocks = new Set();

// 🎯 Power of 2 Validation - The Foundation
const isPowerOfTwo = (n) => {
  return n > 0 && (n & (n - 1)) === 0;
};

const getValidTournamentSizes = () => {
  return [4, 8, 16, 32, 64, 128]; // Supported bracket sizes
};

// ── Bracket scoping (multi-sport + multi-category) ────────────────────────
// A tournament can hold several independent DK brackets: one per (sport,
// category) pair. These two helpers are the single source of truth for
// keeping them apart.

// Normalizes a category input to either a trimmed string or null. "ALL" and
// blanks mean "this sport's one undifferentiated bracket", not a category.
const normalizeBracketCategory = (raw) => {
  const v = (raw == null ? "" : String(raw)).trim();
  if (!v || v.toUpperCase() === "ALL") return null;
  return v;
};

// Delete/read filter for one bracket.
//   category null  → every bracket for this sport (legacy behaviour; also
//                    sweeps up pre-category docs so regenerating stays clean)
//   category set   → only that category's bracket, leaving siblings intact
const bracketFilter = (tournamentId, sportId, category) => {
  const filter = { tournamentId };
  if (sportId) filter.sportId = sportId;
  if (category) filter.category = category;
  return filter;
};

// matchId discriminator. matchId is globally unique, so two brackets in the
// same tournament MUST NOT generate the same one — without this, the second
// bracket's insertMany dies on a duplicate key. Legacy brackets (no sportId,
// no category) keep the original `DK-<tid>-R1-M1` shape, so old data and old
// nextMatchId pointers stay valid.
const bracketKey = (sportId, category) => {
  const parts = [];
  if (sportId) parts.push(`S${String(sportId).slice(-6)}`);
  if (category) {
    const slug = String(category).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
    if (slug) parts.push(`C${slug}`);
  }
  return parts.length ? `-${parts.join("-")}` : "";
};

// 🔥 Validate Player Selection for Direct Knockout
const validatePlayerSelection = async (req, res) => {
  try {
    const { tournamentId, selectedPlayers } = req.body;

    if (!tournamentId || !Array.isArray(selectedPlayers)) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID and selected players array are required"
      });
    }

    const playerCount = selectedPlayers.length;
    const validSizes = getValidTournamentSizes();

    // Check if count is acceptable (we will handle non-power-of-2 by rounding up)
    if (playerCount < 2) {
      return res.status(400).json({
        success: false,
        message: "Tournament requires at least 2 players."
      });
    }

    // Validate players exist — check TopPlayers first, fallback to accepting all
    // (supports both post-group and standalone flows)
    const topPlayersGroups = await TopPlayers.find({ tournamentId });
    const allTopPlayers = topPlayersGroups.flatMap(group => {
      const playersList = (group.players && group.players.length > 0) ? group.players : group.topPlayers;
      return playersList || [];
    });

    // If TopPlayers exist, validate against them. Otherwise skip validation (standalone mode).
    if (allTopPlayers.length > 0) {
      const validPlayers = [];
      for (const selectedPlayer of selectedPlayers) {
        const found = allTopPlayers.find(topPlayer =>
          (topPlayer._id && topPlayer._id.toString() === (selectedPlayer.playerId || '').toString()) ||
          (topPlayer.playerId && topPlayer.playerId.toString() === (selectedPlayer.playerId || '').toString()) ||
          (topPlayer.playerName === selectedPlayer.userName) ||
          (topPlayer.userName === selectedPlayer.userName)
        );
        if (found) validPlayers.push(found);
      }

      if (validPlayers.length !== selectedPlayers.length) {
        return res.status(400).json({
          success: false,
          message: `Some selected players are not in the top players list (${validPlayers.length}/${selectedPlayers.length} matched)`,
          validPlayerCount: validPlayers.length,
          requestedPlayerCount: selectedPlayers.length,
        });
      }
    }

    const bracketSize = getBracketSize(playerCount);
    // const validSizes = getValidTournamentSizes(); // Already declared above
    const withinLimits = validSizes.includes(bracketSize);

    if (!withinLimits) {
      return res.status(400).json({
        success: false,
        message: `Player count requires a bracket size of ${bracketSize}, but allowed sizes are: ${validSizes.join(", ")}`,
        bracketSize,
        validSizes,
        withinLimits: false
      });
    }

    return res.status(200).json({
      success: true,
      message: "Player selection is valid for Direct Knockout",
      playerCount,
      bracketSize,
      rounds: Math.log2(bracketSize),
      validSizes,
      isPowerOfTwo: playerCount === bracketSize,
      withinLimits: true
    });

  } catch (error) {
    console.error("Error validating player selection:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to validate player selection",
      error: error.message
    });
  }
};

// Helper to determine bracket size aligned with allowed sizes
const getBracketSize = (n) => {
  // Find smallest power of 2 >= n
  let v = 1;
  while (v < n) v *= 2;

  // Enforce minimum size of 4
  if (v < 4) return 4;

  return v;
};

// Standard seeding order (Mirror & Flip) — imported from ../utils/seedingUtils.

// 🎪 Generate Tournament Bracket Structure with Draw Methods
// drawMethod: "standard" | "random" | "hybrid"
// numberOfSeeds: how many top players (by input order) get fixed seeding positions
//   standard — all players placed by input order into fixed seeding positions
//   random   — all players shuffled randomly
//   hybrid   — top N (numberOfSeeds) keep order, rest shuffled randomly
const generateBracketStructure = (players, drawMethod = "standard", seededPlayerIds = [], numberOfSeeds = 0, requestedDrawSize = 0) => {
  const playerCount = players.length;
  // Use requested draw size if valid, otherwise compute from player count
  const bracketSize = (requestedDrawSize && requestedDrawSize >= playerCount) ? requestedDrawSize : getBracketSize(playerCount);
  const totalRounds = Math.log2(bracketSize);

  // Get Standard Seeding Order (determines bracket line positions)
  const seedOrder = getSeedOrder(bracketSize);

  // Build rankedPlayers array based on draw method and numberOfSeeds
  let rankedPlayers = [];

  if (drawMethod === "random") {
    // Shuffle all players randomly
    rankedPlayers = shuffle(players);
  } else if (drawMethod === "standard") {
    // Standard: input order = seed order (seed 1 = index 0, seed 2 = index 1, etc.)
    rankedPlayers = [...players];
  } else if (numberOfSeeds > 0 && numberOfSeeds < playerCount) {
    // Top N players keep their order (fixed seeding positions), rest are shuffled
    const seedCount = Math.min(numberOfSeeds, playerCount);
    const seeded = players.slice(0, seedCount);
    const unseeded = shuffle(players.slice(seedCount));
    rankedPlayers = [...seeded, ...unseeded];
  } else {
    // Standard: input order = seed order (seed 1 = index 0, seed 2 = index 1, etc.)
    rankedPlayers = [...players];
  }

  // Determine round names helper
  const getRoundName = (roundNumber, total) => {
    const roundsFromEnd = total - roundNumber + 1;
    if (roundsFromEnd === 1) return "final";
    if (roundsFromEnd === 2) return "semi-final";
    if (roundsFromEnd === 3) return "quarter-final";
    const playersInRound = Math.pow(2, roundsFromEnd);
    return `round-of-${playersInRound}`;
  };

  // R1 slot assignment: route through buildR1SlotAssignment when priority BYE
  // applies (standard = all implicitly seeded by input order; hybrid with
  // numberOfSeeds > 0). Random mode and the 0-seeds fallback keep the legacy
  // "rankedPlayers[seed-1], null if out of range" path.
  const useSlotHelper =
    (drawMethod === "standard" && playerCount > 0) ||
    (drawMethod === "hybrid" && numberOfSeeds > 0 && numberOfSeeds < playerCount) ||
    (drawMethod !== "random" && drawMethod !== "standard" && numberOfSeeds > 0);

  let r1Slots = null;
  if (useSlotHelper) {
    const effectiveSeeds = drawMethod === "standard" ? playerCount : numberOfSeeds;
    const { slots } = buildR1SlotAssignment({
      drawSize: bracketSize,
      numberOfSeeds: effectiveSeeds,
      players: rankedPlayers, // already ordered: seeded first (or all, in standard)
    });
    r1Slots = slots;
  }

  // Generate Rounds
  const bracket = [];

  for (let r = 1; r <= totalRounds; r++) {
    const roundName = getRoundName(r, totalRounds);
    const numMatches = bracketSize / Math.pow(2, r);
    const roundMatches = [];

    for (let m = 0; m < numMatches; m++) {
      if (r === 1) {
        let p1, p2;
        if (r1Slots) {
          // Priority-BYE placement via shared helper. Slot entries carry the
          // original player fields plus a `seed` number when seeded; null = BYE.
          p1 = r1Slots[m * 2] || null;
          p2 = r1Slots[m * 2 + 1] || null;
        } else {
          // Legacy path: random mode / sequential fallback. Uses seedOrder
          // directly and leaves slots null when seed > playerCount.
          const seed1 = seedOrder[m * 2];
          const seed2 = seedOrder[m * 2 + 1];
          p1 = (seed1 <= playerCount) ? rankedPlayers[seed1 - 1] : null;
          p2 = (seed2 <= playerCount) ? rankedPlayers[seed2 - 1] : null;
        }

        roundMatches.push({
          round: roundName,
          roundNumber: r,
          matchNumber: m + 1,
          player1: p1,
          player2: p2,
          bracketPosition: `R${r}M${m + 1}`
        });
      } else {
        // Subsequent rounds: empty slots (winners from previous round)
        roundMatches.push({
          round: roundName,
          roundNumber: r,
          matchNumber: m + 1,
          player1: null,
          player2: null,
          bracketPosition: `R${r}M${m + 1}`
        });
      }
    }

    bracket.push({
      roundNumber: r,
      roundName,
      matches: roundMatches
    });
  }

  return bracket;
};

// 🚀 Create Direct Knockout Matches
const createDirectKnockoutMatches = async (req, res) => {
  const { tournamentId } = req.body || {};

  // Reject concurrent generate requests for the same tournament.
  if (tournamentId && generationLocks.has(String(tournamentId))) {
    return res.status(409).json({
      success: false,
      message: "Another bracket generation is already in progress for this tournament. Please wait for it to finish."
    });
  }
  if (tournamentId) generationLocks.add(String(tournamentId));

  try {
    const { selectedPlayers, schedule, drawMethod, seededPlayers, numberOfSeeds } = req.body;

    // Validate inputs
    if (!tournamentId || !selectedPlayers || !schedule) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID, selected players, and schedule are required"
      });
    }

    // Validate tournament exists and get dynamic match format settings
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    // Validate: player count must not exceed draw size
    const requestedDraw = schedule?.drawSize || getBracketSize(selectedPlayers.length);
    if (getValidTournamentSizes().includes(requestedDraw) && selectedPlayers.length > requestedDraw) {
      return res.status(400).json({
        success: false,
        message: `Too many players (${selectedPlayers.length}) for a ${requestedDraw}-draw. Maximum: ${requestedDraw}`,
      });
    }

    // Lower bound — mirrors the standalone endpoint, which already enforced it.
    // Below half the draw + 1, some first-round match gets BYEs on BOTH sides:
    // neither auto-BYE branch fires, so it sits SCHEDULED forever and its
    // winner slot in the next round is never filled — the bracket stalls with
    // no way forward short of a full reset.
    const minPlayersRequired = Math.ceil(requestedDraw / 2) + 1;
    if (getValidTournamentSizes().includes(requestedDraw) && selectedPlayers.length < minPlayersRequired) {
      return res.status(400).json({
        success: false,
        message: `Need at least ${minPlayersRequired} players for a ${requestedDraw}-draw. Currently: ${selectedPlayers.length}`,
      });
    }

    // Extract dynamic match format from tournament settings.
    // STEP 17b.iv — read per-sport (req.body.sportId is asserted below;
    // here we use it pre-assert for the validation gate).
    const { getMatchFormat: _gmf } = require("../utils/sportTrackUtils");
    const _trackMF = _gmf(tournament, req.body.sportId);
    if (!_trackMF) {
      return res.status(400).json({
        success: false,
        message: "Tournament matchFormat is not configured. Please set match format before creating knockout matches."
      });
    }
    // _trackMF is reused below for the set-based check — the match documents
    // themselves get their format from MatchFactory, not from here.

    // STEP 16d — sportId required at the boundary. Direct knockout has
    // no group context (tournament-level bracket); manager UI sends
    // activeSportId in body.
    try {
      assertSportInTournament(req.body.sportId, tournament);
    } catch (err) {
      if (handleSportContextError(err, res)) return;
      throw err;
    }
    const _dkSportId = req.body.sportId;

    // Generate bracket structure for ALL rounds
    const bracket = generateBracketStructure(selectedPlayers, drawMethod || "standard", seededPlayers || [], numberOfSeeds || 0, requestedDraw);
    const totalRounds = bracket.length;

    // Clear THIS bracket's existing matches to prevent duplicates. Scoped to
    // (sport, category) so regenerating one bracket never destroys a sibling
    // bracket belonging to another sport or category in the same tournament.
    const _dkCategory = normalizeBracketCategory(req.body.category);
    const _dkScope = bracketFilter(tournamentId, _dkSportId, _dkCategory);
    const existingCount = await DirectKnockoutMatch.countDocuments(_dkScope);
    if (existingCount > 0) {
      await DirectKnockoutMatch.deleteMany(_dkScope);
      console.log(`[DK] Cleared ${existingCount} existing matches for ${JSON.stringify(_dkScope)}`);
    }
    const _dkKey = bracketKey(_dkSportId, _dkCategory);

    // Parse base date/time ONCE (Q5 cleanup — was inline inside the inner
    // loop, recomputed per match even though inputs never changed).
    let baseDateTime;
    if (schedule.startDate && schedule.startTime && !schedule.startTime.includes("T")) {
      baseDateTime = new Date(`${schedule.startDate}T${schedule.startTime}`);
    } else if (schedule.startTime) {
      baseDateTime = new Date(schedule.startTime);
    } else {
      baseDateTime = new Date();
    }
    if (isNaN(baseDateTime.getTime())) baseDateTime = new Date();

    // ── Court + time scheduling (Sub-step 4) ──────────────────────────────
    // Pull the active court pool for the active sport and feed the shared
    // round-aware scheduling util. Empty pool → legacy single-court fallback
    // which produces continuous linear scheduling (the pre-Sub-step-4 path).
    const courtPool = (tournament.courts || [])
      .filter((c) => c.isActive !== false)
      .filter((c) => !c.sportId || String(c.sportId) === String(_dkSportId))
      .map((c) => c.name);

    // Normalize the local bracket shape ([{ roundNumber, matches: [...] }]) into
    // the util's expected shape ({ rounds: [{ roundNumber, matchCount }] }).
    const normalizedBracket = {
      rounds: bracket.map((r) => ({
        roundNumber: r.roundNumber,
        matchCount: r.matches.length,
      })),
    };

    const { assignKnockoutSlots, bestOfToSetFormat } = require("../utils/courtScheduling");
    // Per-round bestOf override (Step 3 of flexible bestOf). Set-based sports
    // get matchFormat patched per round; other scoringTypes ignore bestOf.
    // Reuses _trackMF from the validation gate above — same (tournament, sport)
    // pair, so a second getMatchFormat lookup would return the same object.
    const _isSetBased = (_trackMF.scoringType || "").toLowerCase() === "sets";
    const slots = assignKnockoutSlots({
      bracket: normalizedBracket,
      courtPool,
      legacyCourtNumber: schedule.courtNumber,
      baseTime: baseDateTime,
      rounds: schedule.rounds,
      slotDurationMinutes: schedule.slotDurationMinutes,
      matchDurationMinutes: schedule.matchDurationMinutes,
      breakBetweenRoundsMinutes: schedule.breakBetweenRoundsMinutes,
    });

    const roundOffset = 0;
    let allMatchDocs = [];
    let slotIdx = 0;

    // First pass: Create all match objects with IDs
    for (const round of bracket) {
      for (let i = 0; i < round.matches.length; i++) {
        const match = round.matches[i];
        const slot = slots[slotIdx++];
        const dbRoundNumber = round.roundNumber + roundOffset;
        const matchId = `DK-${tournamentId}${_dkKey}-R${dbRoundNumber}-M${match.matchNumber}`;

        // Calculate Next Match ID
        let nextMatchId = null;
        if (round.roundNumber < totalRounds) {
          const nextRound = dbRoundNumber + 1;
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchId = `DK-${tournamentId}${_dkKey}-R${nextRound}-M${nextMatchNum}`;
        }

        // Round 1 null slots are BYEs (no opponent). Later-round null slots
        // are TBD (to be determined by the round's winners). Label them
        // explicitly so the bracket UI shows the right text instead of falling
        // back to the factory default.
        const resolveSlot = (p) => {
          if (p) return { playerId: p.playerId, playerName: p.userName };
          return dbRoundNumber === 1
            ? { playerId: null, playerName: "BYE" }
            : null; // factory default → "TBD"
        };

        const _override = _isSetBased ? bestOfToSetFormat(slot.bestOf) : null;
        allMatchDocs.push(createKnockoutMatch({
          tournament,
          tournamentId,
          sportId: _dkSportId,
          matchId,
          round: match.round,
          roundNumber: dbRoundNumber,
          matchNumber: match.matchNumber,
          player1: resolveSlot(match.player1),
          player2: resolveSlot(match.player2),
          courtNumber: slot.courtNumber,
          matchStartTime: slot.matchStartTime,
          matchEndTime: slot.matchEndTime,
          matchFormatOverride: _override,
          nextMatchId,
          bracketPosition: match.bracketPosition,
          category: _dkCategory,
        }));
      }
    }

    // No auto-BYEs — player count must exactly match draw size
    // BYEs are given manually after match generation via the giveBye endpoint

    // Save all matches
    const savedMatches = await DirectKnockoutMatch.insertMany(allMatchDocs);

    // Auto-BYE: For first-round matches where one player is TBD (null),
    // auto-advance the real player to the next round
    let byeCount = 0;
    const firstRoundMatches = await DirectKnockoutMatch.find({
      ..._dkScope,
      roundNumber: 1,
    });

    // Safe save: ignores DocumentNotFoundError which can arise only if the
    // match was deleted concurrently (shouldn't happen with the generation
    // lock in place, but defensive against manual deletes mid-generate).
    const safeSave = async (doc) => {
      try {
        await doc.save();
      } catch (err) {
        if (err && err.name === "DocumentNotFoundError") {
          console.warn(`[DK BYE] Skipped save for missing doc _id=${doc._id} (likely concurrent delete).`);
          return;
        }
        throw err;
      }
    };

    // A "real" player here means an actual registered player (not a placeholder
    // like "TBD" for next-round slots or "BYE" for empty R1 slots).
    const isRealPlayer = (p) => {
      const name = p?.playerName;
      return !!name && name !== "TBD" && name !== "BYE";
    };

    for (const match of firstRoundMatches) {
      const p1Real = isRealPlayer(match.player1);
      const p2Real = isRealPlayer(match.player2);

      if (p1Real && !p2Real) {
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: match.player1.playerId, playerName: match.player1.playerName },
          finalScore: { player1Sets: 0, player2Sets: 0 },
          matchDuration: 0,
          completedAt: new Date(),
        };
        match.notes = `BYE — ${match.player1.playerName} advances automatically (no opponent).`;
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const slot = match.matchNumber % 2 !== 0 ? "player1" : "player2";
            nextMatch[slot] = { playerId: match.player1.playerId, playerName: match.player1.playerName };
            await safeSave(nextMatch);
          }
        }
        await safeSave(match);
        byeCount++;
      } else if (p2Real && !p1Real) {
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: match.player2.playerId, playerName: match.player2.playerName },
          finalScore: { player1Sets: 0, player2Sets: 0 },
          matchDuration: 0,
          completedAt: new Date(),
        };
        match.notes = `BYE — ${match.player2.playerName} advances automatically (no opponent).`;
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const slot = match.matchNumber % 2 !== 0 ? "player1" : "player2";
            nextMatch[slot] = { playerId: match.player2.playerId, playerName: match.player2.playerName };
            await safeSave(nextMatch);
          }
        }
        await safeSave(match);
        byeCount++;
      }
    }

    // Update tournament to direct knockout mode
    await Tournament.findByIdAndUpdate(tournamentId, {
      roundTwoMode: "direct-knockout"
    });

    return res.status(201).json({
      success: true,
      message: `Direct Knockout matches created successfully${byeCount > 0 ? ` (${byeCount} auto-BYEs)` : ""}`,
      tournament: {
        id: tournamentId,
        mode: "direct-knockout"
      },
      bracket: {
        totalRounds: bracket.length,
        totalMatches: savedMatches.length,
        playerCount: selectedPlayers.length,
        byeCount,
      },
      matches: savedMatches,
      schedule: {
        startTime: `${schedule.startDate}T${schedule.startTime}`,
        court: schedule.courtNumber || schedule.courtNumbers || 1,
        interval: schedule.intervalMinutes
      }
    });

  } catch (error) {
    console.error("Error creating Direct Knockout matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create Direct Knockout matches",
      error: error.message
    });
  } finally {
    if (tournamentId) generationLocks.delete(String(tournamentId));
  }
};

// 📊 Get Direct Knockout Matches for Tournament
const getDirectKnockoutMatches = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { sportId } = req.query;

    if (!tournamentId) {
      return res.status(400).json({
        success: false,
        message: "Tournament ID is required"
      });
    }

    // Multi-sport + multi-category: strict scope match.
    const matchFilter = bracketFilter(
      tournamentId,
      sportId,
      normalizeBracketCategory(req.query.category)
    );
    let matches = await DirectKnockoutMatch.find(matchFilter)
      .populate('player1.playerId', 'name profileImage')
      .populate('player2.playerId', 'name profileImage')
      .sort({ roundNumber: 1, matchNumber: 1 });

    // Self-heal: scan for completed matches whose winners haven't been pushed
    // to the next-round slot, and run progression. Fixes brackets where a prior
    // bulk upload completed matches before progression was wired in.
    try {
      const byMatchId = new Map();
      matches.forEach((m) => { if (m.matchId) byMatchId.set(m.matchId, m); });
      let healed = false;
      for (const m of matches) {
        if (String(m.status).toUpperCase() !== "COMPLETED") continue;
        if (!m.nextMatchId) continue;
        const nextMatch = byMatchId.get(m.nextMatchId);
        if (!nextMatch) continue;
        // Winner may be identified by playerId (real users) OR by playerName
        // only (guest-booking tournaments store playerId: null).
        const winnerObj =
          m.result?.winner ||
          m.matchResult?.winner ||
          m.winner;
        const winnerId = winnerObj?.playerId;
        const winnerName = winnerObj?.playerName;
        if (!winnerId && (!winnerName || winnerName === "TBD")) continue;
        const winnerIdStr = winnerId ? winnerId.toString() : null;
        const nextP1Id = nextMatch.player1?.playerId?._id?.toString?.() || nextMatch.player1?.playerId?.toString?.();
        const nextP2Id = nextMatch.player2?.playerId?._id?.toString?.() || nextMatch.player2?.playerId?.toString?.();
        const nextP1Name = nextMatch.player1?.playerName;
        const nextP2Name = nextMatch.player2?.playerName;
        const alreadyThere =
          (winnerIdStr && (nextP1Id === winnerIdStr || nextP2Id === winnerIdStr)) ||
          (winnerName && (nextP1Name === winnerName || nextP2Name === winnerName));
        if (alreadyThere) continue;
        try {
          // Re-fetch WITHOUT populate — processDirectKnockoutProgression does
          // `match.player1.playerId.toString()` which breaks on populated docs.
          const freshMatch = await DirectKnockoutMatch.findById(m._id);
          await processDirectKnockoutProgression(freshMatch, winnerId || winnerObj);
          healed = true;
        } catch (progErr) {
          console.warn(`[HEAL] Progression error for ${m.matchId}:`, progErr.message);
        }
      }
      if (healed) {
        // Re-fetch with the SAME scope as the original query — a bare
        // { tournamentId } here leaked every sport's/category's matches into
        // the response whenever a heal ran.
        matches = await DirectKnockoutMatch.find(matchFilter)
          .populate('player1.playerId', 'name profileImage')
          .populate('player2.playerId', 'name profileImage')
          .sort({ roundNumber: 1, matchNumber: 1 });
      }
    } catch (healErr) {
      console.warn("[HEAL] Self-heal pass failed:", healErr.message);
    }

    // Enrich each match with category derived from BookingGroup+TopPlayers lookup.
    // DirectKnockoutMatch doesn't carry category itself.
    const [bookingGroups, topPlayersDocs, tournamentDoc] = await Promise.all([
      BookingGroup.find({ tournamentId }).select("category players").lean(),
      TopPlayers.find({ tournamentId }).select("topPlayers players").lean(),
      Tournament.findById(tournamentId).select("category").lean(),
    ]);
    const idToCategory = {};
    const nameToCategory = {};
    bookingGroups.forEach((g) => {
      if (!g.category) return;
      (g.players || []).forEach((p) => {
        if (p.playerId) idToCategory[p.playerId.toString()] = g.category;
        if (p.userName) nameToCategory[p.userName] = g.category;
      });
    });
    topPlayersDocs.forEach((doc) => {
      (doc.topPlayers || []).concat(doc.players || []).forEach((p) => {
        if (!p?.category) return;
        if (p.playerId) idToCategory[p.playerId.toString()] = p.category;
        const nm = p.playerName || p.userName;
        if (nm) nameToCategory[nm] = p.category;
      });
    });

    // Build a normalizer that maps raw/slugged values (e.g., "open_category",
    // "above_40", "Open") to the canonical tournament.category[].name.
    const canonicalNames = (tournamentDoc?.category || []).map((c) => c?.name).filter(Boolean);
    const slugify = (s) => String(s || "").toLowerCase().replace(/[\s_-]+/g, "").trim();
    const canonicalBySlug = {};
    canonicalNames.forEach((n) => { canonicalBySlug[slugify(n)] = n; });
    const normalizeCategory = (raw) => {
      if (!raw) return raw;
      const slug = slugify(raw);
      if (canonicalBySlug[slug]) return canonicalBySlug[slug];
      // Partial match — e.g., raw "Open" → "Open Category"
      const partial = canonicalNames.find((n) => {
        const ns = slugify(n);
        return ns.startsWith(slug) || slug.startsWith(ns);
      });
      return partial || raw;
    };

    const enriched = matches.map((m) => {
      const obj = m.toObject();
      const p1Id = obj.player1?.playerId?._id?.toString?.() || obj.player1?.playerId?.toString?.();
      const p2Id = obj.player2?.playerId?._id?.toString?.() || obj.player2?.playerId?.toString?.();
      // Stored category (stamped at generation) is authoritative. The
      // BookingGroup/TopPlayers lookup is only a fallback for pre-category
      // brackets, where DirectKnockoutMatch carried no category of its own.
      const cat =
        obj.category ||
        idToCategory[p1Id] ||
        idToCategory[p2Id] ||
        nameToCategory[obj.player1?.playerName] ||
        nameToCategory[obj.player2?.playerName] ||
        null;
      if (cat) obj.category = normalizeCategory(cat);
      return obj;
    });

    // Group matches by round for easier frontend handling
    const matchesByRound = enriched.reduce((acc, match) => {
      if (!acc[match.round]) {
        acc[match.round] = [];
      }
      acc[match.round].push(match);
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      tournament: tournamentId,
      mode: "direct-knockout",
      totalMatches: enriched.length,
      rounds: Object.keys(matchesByRound).length,
      matches: enriched,
      matchesByRound
    });

  } catch (error) {
    console.error("Error fetching Direct Knockout matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Direct Knockout matches",
      error: error.message
    });
  }
};

// 🛠️ Helper: Process Direct Knockout Progression Logic
// winnerRef may be a playerId (string/ObjectId) OR a winner object
// { playerId, playerName }. Guest-booking tournaments have playerId: null,
// so we fall back to matching by playerName.
const processDirectKnockoutProgression = async (match, winnerRef) => {
  try {
    // If we only have matchId, fetch the doc
    if (typeof match === 'string') {
      match = await DirectKnockoutMatch.findOne({ matchId: match });
    }

    if (!match || !match.nextMatchId) {
      return { success: true, message: "No next match to progress to" };
    }

    const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
    if (!nextMatch) {
      return { success: false, message: "Next match found in ID but not in DB" };
    }

    // Normalize winnerRef → { id, name }
    let winnerIdStr = null;
    let winnerNameRef = null;
    if (winnerRef && typeof winnerRef === "object" && !mongoose.isValidObjectId(winnerRef)) {
      winnerIdStr = winnerRef.playerId ? winnerRef.playerId.toString() : null;
      winnerNameRef = winnerRef.playerName || null;
    } else if (winnerRef) {
      winnerIdStr = winnerRef.toString();
    }

    // Get winner info directly from the match (not TopPlayers — works for both standalone and post-group)
    const p1Id = match.player1?.playerId?.toString();
    const p2Id = match.player2?.playerId?.toString();

    let winnerData;
    if (winnerIdStr && p1Id === winnerIdStr) {
      winnerData = { playerId: match.player1.playerId, playerName: match.player1.playerName };
    } else if (winnerIdStr && p2Id === winnerIdStr) {
      winnerData = { playerId: match.player2.playerId, playerName: match.player2.playerName };
    } else if (winnerNameRef && match.player1?.playerName === winnerNameRef) {
      winnerData = { playerId: match.player1.playerId, playerName: match.player1.playerName };
    } else if (winnerNameRef && match.player2?.playerName === winnerNameRef) {
      winnerData = { playerId: match.player2.playerId, playerName: match.player2.playerName };
    } else {
      return { success: false, message: "Winner does not match either player in this match" };
    }

    // Determine which player slot to fill in next match
    const isOddMatch = match.matchNumber % 2 !== 0;
    const playerSlot = isOddMatch ? 'player1' : 'player2';

    nextMatch[playerSlot] = {
      playerId: winnerData.playerId,
      playerName: winnerData.playerName
    };

    await nextMatch.save({ validateModifiedOnly: true });

    return {
      success: true,
      nextMatchId: nextMatch.matchId,
      targetSlot: playerSlot,
      winnerName: winnerData.playerName
    };

  } catch (error) {
    console.error("Error in processDirectKnockoutProgression:", error);
    return { success: false, error: error.message };
  }
};

// 🎯 Progress Winner to Next Match (API Handler)
const progressWinnerToNextMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { winnerId } = req.body;

    if (!matchId || !winnerId) {
      return res.status(400).json({
        success: false,
        message: "Match ID and winner ID are required"
      });
    }

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Direct Knockout match not found"
      });
    }

    if (match.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Match must be completed before progressing winner"
      });
    }

    const result = await processDirectKnockoutProgression(match, winnerId);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message || "Winner progressed to next match",
        data: result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message || "Failed to progress winner",
        error: result.error
      });
    }

  } catch (error) {
    console.error("Error progressing winner:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to progress winner",
      error: error.message
    });
  }
};

// =====================================================
// STANDALONE MODE — No Group Stage Required
// =====================================================

// Validate players for standalone knockout (no TopPlayers check)
const validateStandalonePlayers = async (req, res) => {
  try {
    const { players, drawSize } = req.body;

    if (!Array.isArray(players) || players.length < 2) {
      return res.status(400).json({ success: false, message: "At least 2 players required" });
    }

    const bracketSize = drawSize || players.length;
    const validSizes = getValidTournamentSizes();

    if (!validSizes.includes(bracketSize)) {
      return res.status(400).json({
        success: false,
        message: `Draw size ${bracketSize} not supported. Use: ${validSizes.join(", ")}`,
      });
    }

    if (players.length > bracketSize) {
      return res.status(400).json({
        success: false,
        message: `Too many players (${players.length}) for a ${bracketSize}-draw. Maximum: ${bracketSize}`,
      });
    }

    const minPlayers = Math.ceil(bracketSize / 2) + 1;
    if (players.length < minPlayers) {
      return res.status(400).json({
        success: false,
        message: `Need at least ${minPlayers} players for a ${bracketSize}-draw. Currently: ${players.length}`,
      });
    }

    const rounds = Math.log2(bracketSize);
    const byeCount = bracketSize - players.length;

    return res.json({
      success: true,
      playerCount: players.length,
      bracketSize,
      rounds,
      totalMatches: bracketSize - 1,
      byeCount,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Create standalone knockout matches — players passed directly, no TopPlayers needed
const createStandaloneKnockout = async (req, res) => {
  try {
    const { tournamentId, players, schedule, drawSize, drawMethod, seededPlayers, numberOfSeeds } = req.body;

    if (!tournamentId || !Array.isArray(players) || players.length < 2) {
      return res.status(400).json({
        success: false,
        message: "tournamentId and at least 2 players are required",
      });
    }

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    // Validate: player count must exactly match draw size
    const selectedDraw = drawSize || players.length;
    const validSizes = getValidTournamentSizes();

    if (!validSizes.includes(selectedDraw)) {
      return res.status(400).json({
        success: false,
        message: `Draw size ${selectedDraw} not supported. Use: ${validSizes.join(", ")}`,
      });
    }

    if (players.length > selectedDraw) {
      return res.status(400).json({
        success: false,
        message: `Too many players (${players.length}) for a ${selectedDraw}-draw. Maximum: ${selectedDraw}`,
      });
    }

    const minPlayers = Math.ceil(selectedDraw / 2) + 1;
    if (players.length < minPlayers) {
      return res.status(400).json({
        success: false,
        message: `Need at least ${minPlayers} players for a ${selectedDraw}-draw. Currently: ${players.length}`,
      });
    }

    // Require explicit confirmation parameter in body before destructive create
    if (req.body.confirm !== true) {
      const bracketSizePreview = drawSize || getBracketSize(players.length);
      const byePreview = bracketSizePreview - players.length;
      return res.status(400).json({
        success: false,
        confirmationRequired: true,
        message: "Confirmation required to create bracket. Re-submit with { confirm: true } to proceed.",
        playerCount: players.length,
        bracketSize: bracketSizePreview,
        byes: byePreview,
      });
    }

    const bracketSize = drawSize || getBracketSize(players.length);

    // Normalize player format
    const normalizedPlayers = players.map((p, i) => ({
      playerId: p.playerId || p._id || null,
      userName: p.userName || p.playerName || p.name || `Player ${i + 1}`,
    }));

    // Build match format from tournament — NO hardcoded TT defaults.
    // STEP 17b.iv — read matchFormat per-sport.
    const { getMatchFormat: _gmf2 } = require("../utils/sportTrackUtils");
    const _track2MF = _gmf2(tournament, req.body.sportId);
    if (!_track2MF) {
      return res.status(400).json({
        success: false,
        message: "Tournament matchFormat is not configured. Please set match format before creating knockout matches."
      });
    }
    // No format is built here on purpose — MatchFactory resolves and freezes it
    // per match. _track2MF exists only as the "is it configured?" gate above and
    // for the set-based check further down.

    // STEP 16d — sportId required at the boundary (standalone knockout
    // is tournament-level, no group context).
    try {
      assertSportInTournament(req.body.sportId, tournament);
    } catch (err) {
      if (handleSportContextError(err, res)) return;
      throw err;
    }
    const _standaloneSportId = req.body.sportId;

    // Clear THIS bracket only — scoped to (sport, category) so generating the
    // Above-40 draw never wipes the Open draw, or Carrom's bracket Badminton's.
    // Deliberately runs AFTER the sport assertion: a rejected request must not
    // destroy an existing bracket on its way out.
    const _skCategory = normalizeBracketCategory(req.body.category);
    const _skScope = bracketFilter(tournamentId, _standaloneSportId, _skCategory);
    await DirectKnockoutMatch.deleteMany(_skScope);
    const _skKey = bracketKey(_standaloneSportId, _skCategory);

    // Generate bracket
    const bracket = generateBracketStructure(normalizedPlayers, drawMethod || "standard", seededPlayers || [], numberOfSeeds || 0, bracketSize);
    const totalRounds = bracket.length;

    const sched = schedule || {};
    let baseDateTime;
    if (sched.startDate && sched.startTime) {
      baseDateTime = new Date(`${sched.startDate}T${sched.startTime}`);
    } else {
      baseDateTime = new Date();
    }
    if (isNaN(baseDateTime.getTime())) baseDateTime = new Date();

    // ── Court + time scheduling (Sub-step 4) ──────────────────────────────
    // Prefer explicit courtCount from request (manager modal). Falls back to
    // tournament.courts if present. Empty pool → legacy single-court fallback.
    let courtPool = [];
    const bodyCourtCount = parseInt(req.body.courtCount, 10);
    if (Number.isFinite(bodyCourtCount) && bodyCourtCount > 0) {
      // Name courts as sequential numbers ("1", "2", ...).
      courtPool = Array.from({ length: bodyCourtCount }, (_, i) => String(i + 1));
    } else {
      courtPool = (tournament.courts || [])
        .filter((c) => c.isActive !== false)
        .filter((c) => !c.sportId || String(c.sportId) === String(_standaloneSportId))
        .map((c) => c.name);
    }

    const normalizedBracket = {
      rounds: bracket.map((r) => ({
        roundNumber: r.roundNumber,
        matchCount: r.matches.length,
      })),
    };

    const { assignKnockoutSlots, bestOfToSetFormat } = require("../utils/courtScheduling");
    // Per-round bestOf override (Step 3 of flexible bestOf).
    // Reuses _track2MF from the validation gate above — same (tournament, sport)
    // pair, so a second getMatchFormat lookup would return the same object.
    const _isSetBased = (_track2MF.scoringType || "").toLowerCase() === "sets";

    // Derive per-round/legacy scheduling values. Accept explicit matchDurationMinutes
    // and gapMinutes from the request (manager-supplied fields in the modal).
    const bodyMatchDur = Number(req.body.matchDurationMinutes);
    const bodyGap = Number(req.body.gapMinutes);

    const slotDurationMinutes = (sched.slotDurationMinutes != null)
      ? sched.slotDurationMinutes
      : (Number.isFinite(bodyMatchDur) && Number.isFinite(bodyGap) ? (bodyMatchDur + bodyGap) : undefined);

    const matchDurationMinutes = (sched.matchDurationMinutes != null)
      ? sched.matchDurationMinutes
      : (Number.isFinite(bodyMatchDur) ? bodyMatchDur : undefined);

    const breakBetweenRoundsMinutes = (sched.breakBetweenRoundsMinutes != null)
      ? sched.breakBetweenRoundsMinutes
      : (Number.isFinite(bodyGap) ? bodyGap : 0);

    const slots = assignKnockoutSlots({
      bracket: normalizedBracket,
      courtPool,
      legacyCourtNumber: sched.courtNumber,
      baseTime: baseDateTime,
      rounds: sched.rounds,
      slotDurationMinutes,
      matchDurationMinutes,
      breakBetweenRoundsMinutes,
    });

    const allMatchDocs = [];
    let slotIdx = 0;

    for (const round of bracket) {
      for (const match of round.matches) {
        const slot = slots[slotIdx++];
        const matchId = `DK-${tournamentId}${_skKey}-R${round.roundNumber}-M${match.matchNumber}`;

        let nextMatchId = null;
        if (round.roundNumber < totalRounds) {
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          nextMatchId = `DK-${tournamentId}${_skKey}-R${round.roundNumber + 1}-M${nextMatchNum}`;
        }

        const _override = _isSetBased ? bestOfToSetFormat(slot.bestOf) : null;
        allMatchDocs.push(createKnockoutMatch({
          tournament,
          tournamentId,
          sportId: _standaloneSportId,
          matchId,
          round: match.round,
          roundNumber: round.roundNumber,
          matchNumber: match.matchNumber,
          player1: match.player1
            ? { playerId: match.player1.playerId || null, playerName: match.player1.userName || "TBD" }
            : null,
          player2: match.player2
            ? { playerId: match.player2.playerId || null, playerName: match.player2.userName || "TBD" }
            : null,
          courtNumber: slot.courtNumber,
          matchStartTime: slot.matchStartTime,
          matchEndTime: slot.matchEndTime,
          matchFormatOverride: _override,
          nextMatchId,
          bracketPosition: match.bracketPosition,
          mode: "direct-knockout",
          category: _skCategory,
        }));
      }
    }

    const saved = await DirectKnockoutMatch.insertMany(allMatchDocs);

    // Auto-BYE: For first-round matches where one player is TBD (null),
    // auto-advance the real player to the next round. Scoped to this bracket —
    // an unscoped roundNumber:1 query would sweep sibling brackets too.
    let byeCount = 0;
    const firstRoundMatches = await DirectKnockoutMatch.find({
      ..._skScope,
      roundNumber: 1,
    });

    for (const match of firstRoundMatches) {
      const p1Real = match.player1?.playerName && match.player1.playerName !== "TBD";
      const p2Real = match.player2?.playerName && match.player2.playerName !== "TBD";

      // Only auto-BYE when exactly one player is real and the other is TBD
      if (p1Real && !p2Real) {
        // Player 1 gets auto-advance, Player 2 is BYE
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: match.player1.playerId, playerName: match.player1.playerName },
          finalScore: { player1Sets: 0, player2Sets: 0 },
          matchDuration: 0,
          completedAt: new Date(),
        };
        match.notes = `BYE — ${match.player1.playerName} advances automatically (no opponent).`;

        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const slot = match.matchNumber % 2 !== 0 ? "player1" : "player2";
            nextMatch[slot] = { playerId: match.player1.playerId, playerName: match.player1.playerName };
            await nextMatch.save({ validateModifiedOnly: true });
          }
        }
        await match.save({ validateModifiedOnly: true });
        byeCount++;
      } else if (p2Real && !p1Real) {
        // Player 2 gets auto-advance, Player 1 is BYE
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: match.player2.playerId, playerName: match.player2.playerName },
          finalScore: { player1Sets: 0, player2Sets: 0 },
          matchDuration: 0,
          completedAt: new Date(),
        };
        match.notes = `BYE — ${match.player2.playerName} advances automatically (no opponent).`;

        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const slot = match.matchNumber % 2 !== 0 ? "player1" : "player2";
            nextMatch[slot] = { playerId: match.player2.playerId, playerName: match.player2.playerName };
            await nextMatch.save({ validateModifiedOnly: true });
          }
        }
        await match.save({ validateModifiedOnly: true });
        byeCount++;
      }
    }

    // Update tournament
    await Tournament.findByIdAndUpdate(tournamentId, { roundTwoMode: "direct-knockout" });

    return res.status(201).json({
      success: true,
      message: `Direct Knockout bracket created: ${saved.length} matches across ${totalRounds} rounds${byeCount > 0 ? ` (${byeCount} auto-BYEs)` : ""}`,
      bracket: {
        totalRounds,
        totalMatches: saved.length,
        playerCount: normalizedPlayers.length,
        bracketSize,
        byes: bracketSize - normalizedPlayers.length,
        byeCount,
      },
      matches: saved,
    });
  } catch (err) {
    console.error("[STANDALONE_KNOCKOUT] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// =====================================================
// LIVE SCORING for Direct Knockout Matches
// =====================================================

// Complete a game in a Direct Knockout match
const completeGame = async (req, res) => {
  try {
    const { matchId } = req.params;
    // penaltyWinner ("player1"|"player2") decides a LEVEL knockout match for
    // time-based sports (Football) — a penalty shootout.
    const { player1Score, player2Score, penaltyWinner = null } = req.body;

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) return res.status(404).json({ success: false, message: "Match not found" });
    if (match.status === "COMPLETED") return res.status(400).json({ success: false, message: "Match already completed" });

    // ═══ GUARD: Authorization check (Phase 4b) ═══
    // Caller must be (a) a manager of this tournament, or
    // (b) an umpire authorized per umpireAuth (match-level or stage-level grant).
    const callerId = req.user?._id?.toString() || req.user?.id?.toString();
    if (!callerId) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    let authorized = false;
    if (req.userRole === "Manager") {
      const TournamentModel = require("../src/modules/tournaments/models/Tournament");
      const tournamentDoc = await TournamentModel.findById(match.tournamentId)
        .select("managerId")
        .lean();
      const managerIds = Array.isArray(tournamentDoc?.managerId)
        ? tournamentDoc.managerId.map((id) => id?.toString())
        : tournamentDoc?.managerId
        ? [tournamentDoc.managerId.toString()]
        : [];
      authorized = managerIds.includes(callerId);
    } else {
      const { isUmpireAuthorizedForMatch } = require("../utils/umpireAuth");
      const result = await isUmpireAuthorizedForMatch(callerId, match);
      authorized = !!result.authorized;
    }

    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to score this match.",
      });
    }

    // Time/innings/single sports (Football, Cricket, Chess) CAN end level —
    // resolved by a tie-break winner below. Set/board sports can't tie.
    const _earlySt = (match.scoringType || match.matchFormat?.scoringType || "sets").toLowerCase();
    if (player1Score === player2Score && !["time", "innings", "single"].includes(_earlySt)) {
      return res.status(400).json({ success: false, message: "Scores cannot be tied" });
    }

    // Start match if scheduled
    if (match.status === "SCHEDULED") match.status = "IN_PROGRESS";

    const setIdx = match.currentSet - 1;

    // Ensure set exists
    if (!match.sets[setIdx]) {
      match.sets.push({
        setNumber: match.currentSet,
        status: "IN_PROGRESS",
        games: [],
      });
    }

    const currentSet = match.sets[setIdx];

    // Guard: don't allow scoring if current set is already completed
    if (currentSet.status === "COMPLETED") {
      return res.status(400).json({ success: false, message: `Set ${match.currentSet} is already completed` });
    }

    // Read validated match format (throws if missing \u2014 match was not properly initialized)
    const fmt = readMatchFormat(match);

    // Sport-aware shape detection.
    // Nested-game sports (Tennis): a set contains multiple games \u2014 tally them.
    // Flat-set sports (TT, Badminton): a set is atomic \u2014 one game IS the set.
    // ═══ Sport-aware scoring ═══
    // scoringType lives at the top level of the match (set at creation). Non-set
    // sports (time/innings/single) submit the FINAL match totals in a single
    // call — the higher score wins and completes the match outright. No sets.
    const scoringType = (match.scoringType || fmt.scoringType || "sets").toLowerCase();
    // "board" (Carrom) belongs here too — it was previously omitted, so the
    // SAME match stored a different shape depending on whether it was scored
    // live or bulk-uploaded (bulkUploadScores already treated board as
    // non-set). Non-set is the canonical reading: matchUtils labels board
    // results in "Boards" with no sub-round, validateMatchResult gives it its
    // own _validateBoard, and the group-stage scoreboard treats it as non-set
    // in every generic check.
    const isNonSetSport =
      scoringType === "time" || scoringType === "innings" ||
      scoringType === "single" || scoringType === "board";

    if (isNonSetSport) {
      // A knockout match can't end level. Time/innings ties are decided by the
      // manager-entered penalty-shootout winner (Football penalties, cricket
      // super-over). Without it, reject so the UI can prompt.
      let matchWinner;
      let shootout = false;
      if (player1Score === player2Score) {
        if (penaltyWinner !== "player1" && penaltyWinner !== "player2") {
          return res.status(400).json({
            success: false,
            needsTiebreak: true,
            message: "Knockout match ended level — enter a penalty-shootout winner to decide it.",
          });
        }
        matchWinner = penaltyWinner === "player1" ? match.player1 : match.player2;
        shootout = true;
      } else {
        matchWinner = player1Score > player2Score ? match.player1 : match.player2;
      }

      // Record one completed "set/game" so the stored shape stays consistent
      // with set-based matches (audit + UI), but the decisive values are the
      // real totals (goals / runs / points).
      match.sets = [{
        setNumber: 1,
        status: "COMPLETED",
        winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
        games: [{
          gameNumber: 1,
          status: "COMPLETED",
          finalScore: { player1: player1Score, player2: player2Score },
          winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
          startTime: new Date(),
          endTime: new Date(),
        }],
      }];
      match.liveScore = { player1Points: player1Score, player2Points: player2Score };
      match.status = "COMPLETED";
      // finalScore holds the actual decisive totals (what the results export
      // displays, e.g. "3-1"). matchResult is the normalized source of truth
      // carrying the real scoringType.
      match.result = {
        winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
        finalScore: { player1Sets: player1Score, player2Sets: player2Score },
        completedAt: new Date(),
      };
      match.matchResult = {
        scoringType,
        player1Score,
        player2Score,
        winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
        ...(shootout ? { tiebreak: { type: "penalties", winner: penaltyWinner } } : {}),
        completedAt: new Date(),
      };

      // Auto-progress winner to next match (same slot logic as the set path).
      if (match.nextMatchId) {
        const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
        if (nextMatch) {
          const isOdd = match.matchNumber % 2 !== 0;
          const slot = isOdd ? "player1" : "player2";
          nextMatch[slot] = { playerId: matchWinner.playerId, playerName: matchWinner.playerName };
          await nextMatch.save({ validateModifiedOnly: true });
        }
      }

      await match.save({ validateModifiedOnly: true });
      return res.json({
        success: true,
        message: "Match completed!",
        match: {
          matchId: match.matchId,
          status: match.status,
          sets: match.sets,
          result: match.result,
          matchResult: match.matchResult,
        },
      });
    }

    // ═══ SET-BASED sports (badminton, tennis, table tennis, squash) ═══
    const { hasNestedGames } = require("../factories/MatchFactory");
    const nested = hasNestedGames(fmt);

    // Guard: check if set is already decided before adding game.
    // Only meaningful for nested sports where games[] can accumulate.
    if (nested) {
      const gamesToWinCheck = fmt.gamesToWin;
      const existingP1Games = (currentSet.games || []).filter((g) => g.winner?.playerName === match.player1.playerName).length;
      const existingP2Games = (currentSet.games || []).filter((g) => g.winner?.playerName === match.player2.playerName).length;
      if (existingP1Games >= gamesToWinCheck || existingP2Games >= gamesToWinCheck) {
        // Set already decided \u2014 auto-advance to next set
        currentSet.status = "COMPLETED";
        const setW = existingP1Games >= gamesToWinCheck ? match.player1 : match.player2;
        currentSet.winner = { playerId: setW.playerId, playerName: setW.playerName };
        match.currentSet += 1;
        match.currentGame = 1;
        if (!match.sets[match.currentSet - 1]) {
          match.sets.push({ setNumber: match.currentSet, status: "IN_PROGRESS", games: [] });
        }
        await match.save({ validateModifiedOnly: true });
        return res.status(400).json({ success: false, message: `Set ${match.currentSet - 1} was already won. Moved to Set ${match.currentSet}. Please re-submit.` });
      }
    }

    const gameWinner = player1Score > player2Score ? "player1" : "player2";
    const winnerData = gameWinner === "player1" ? match.player1 : match.player2;

    // Add game
    currentSet.games.push({
      gameNumber: match.currentGame,
      status: "COMPLETED",
      finalScore: { player1: player1Score, player2: player2Score },
      winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
      startTime: new Date(),
      endTime: new Date(),
    });

    // Sport-aware set-win decision.
    // Nested: tally games in this set; flat: the game just added IS the set winner.
    let p1Games, p2Games, setWon, setWinner;
    if (nested) {
      p1Games = currentSet.games.filter((g) => g.winner?.playerName === match.player1.playerName).length;
      p2Games = currentSet.games.filter((g) => g.winner?.playerName === match.player2.playerName).length;
      const gamesToWin = fmt.gamesToWin;
      if (p1Games >= gamesToWin || p2Games >= gamesToWin) {
        setWon = true;
        setWinner = p1Games >= gamesToWin ? match.player1 : match.player2;
      } else {
        setWon = false;
      }
    } else {
      // Flat-set: the single game just pushed IS the set.
      p1Games = gameWinner === "player1" ? 1 : 0;
      p2Games = gameWinner === "player2" ? 1 : 0;
      setWon = true;
      setWinner = winnerData;
    }

    if (setWon) {
      // Set complete
      currentSet.status = "COMPLETED";
      currentSet.winner = { playerId: setWinner.playerId, playerName: setWinner.playerName };

      // Count set wins
      const p1Sets = match.sets.filter((s) => s.winner?.playerName === match.player1.playerName).length;
      const p2Sets = match.sets.filter((s) => s.winner?.playerName === match.player2.playerName).length;

      const setsToWin = fmt.setsToWin;

      if (p1Sets >= setsToWin || p2Sets >= setsToWin) {
        // Match complete
        const matchWinner = p1Sets >= setsToWin ? match.player1 : match.player2;
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
          finalScore: { player1Sets: p1Sets, player2Sets: p2Sets },
          completedAt: new Date(),
        };

        // Auto-progress winner to next match
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const isOdd = match.matchNumber % 2 !== 0;
            const slot = isOdd ? "player1" : "player2";
            nextMatch[slot] = { playerId: matchWinner.playerId, playerName: matchWinner.playerName };
            await nextMatch.save({ validateModifiedOnly: true });
          }
        }
      } else {
        // Move to next set
        match.currentSet += 1;
        match.currentGame = 1;
        match.sets.push({
          setNumber: match.currentSet,
          status: "IN_PROGRESS",
          games: [],
        });
      }
    } else {
      // Only nested reaches here \u2014 continue to next game in current set
      match.currentGame += 1;
    }

    // Update live score
    match.liveScore = { player1Points: player1Score, player2Points: player2Score };

    await match.save({ validateModifiedOnly: true });

    return res.json({
      success: true,
      message: match.status === "COMPLETED" ? "Match completed!" : "Game recorded",
      match: {
        matchId: match.matchId,
        status: match.status,
        currentSet: match.currentSet,
        currentGame: match.currentGame,
        sets: match.sets,
        result: match.result,
      },
    });
  } catch (err) {
    console.error("[DK_COMPLETE_GAME] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Bulk score upload for Direct Knockout matches
const bulkUploadScores = async (req, res) => {
  try {
    const { tournamentId, scores } = req.body;

    if (!tournamentId || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ success: false, message: "tournamentId and scores array required" });
    }

    const results = [];
    const errors = [];

    for (const entry of scores) {
      const { matchId, sets: setScores } = entry;

      // Set-based sports send a `sets` array; non-set sports may send a single
      // final score as { player1Score, player2Score } (or a one-row `sets`).
      const hasSets = Array.isArray(setScores) && setScores.length > 0;
      const hasFinal = entry.player1Score != null && entry.player2Score != null;
      if (!matchId || (!hasSets && !hasFinal)) {
        errors.push({ matchId, error: "matchId and sets (or final score) required" });
        continue;
      }

      try {
        const match = await DirectKnockoutMatch.findOne({
          $or: [{ matchId }, { _id: mongoose.Types.ObjectId.isValid(matchId) ? matchId : undefined }].filter(Boolean),
          tournamentId,
        });

        if (!match) { errors.push({ matchId, error: "Match not found" }); continue; }
        if (match.status === "COMPLETED") { errors.push({ matchId, error: "Already completed" }); continue; }

        const byeFmt = readMatchFormat(match);
        const bulkScoringType = (match.scoringType || byeFmt.scoringType || "sets").toLowerCase();
        const bulkIsNonSet =
          bulkScoringType === "time" || bulkScoringType === "innings" ||
          bulkScoringType === "single" || bulkScoringType === "board";

        // ═══ Non-set sports: a single decisive final score completes the match ═══
        if (bulkIsNonSet) {
          const fin = hasFinal
            ? { player1Score: entry.player1Score, player2Score: entry.player2Score }
            : setScores[0];
          if (!fin || fin.player1Score == null || fin.player2Score == null) {
            errors.push({ matchId, error: "Final score required" });
            continue;
          }
          if (fin.player1Score === fin.player2Score) {
            errors.push({ matchId, error: "Scores cannot be tied" });
            continue;
          }
          const winnerData = fin.player1Score > fin.player2Score ? match.player1 : match.player2;

          match.sets = [{
            setNumber: 1,
            status: "COMPLETED",
            winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
            games: [{
              gameNumber: 1,
              status: "COMPLETED",
              finalScore: { player1: fin.player1Score, player2: fin.player2Score },
              winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
              startTime: new Date(),
              endTime: new Date(),
            }],
          }];
          match.status = "COMPLETED";
          match.result = {
            winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
            finalScore: { player1Sets: fin.player1Score, player2Sets: fin.player2Score },
            completedAt: new Date(),
          };
          match.matchResult = {
            scoringType: bulkScoringType,
            player1Score: fin.player1Score,
            player2Score: fin.player2Score,
            winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
            completedAt: new Date(),
          };

          if (match.nextMatchId) {
            const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
            if (nextMatch) {
              const isOdd = match.matchNumber % 2 !== 0;
              const slot = isOdd ? "player1" : "player2";
              nextMatch[slot] = { playerId: winnerData.playerId, playerName: winnerData.playerName };
              await nextMatch.save({ validateModifiedOnly: true });
            }
          }

          await match.save({ validateModifiedOnly: true });
          results.push({
            matchId: match.matchId,
            player1: match.player1.playerName,
            player2: match.player2.playerName,
            winner: winnerData.playerName,
            finalScore: `${fin.player1Score}-${fin.player2Score}`,
          });
          continue;
        }

        // ═══ SET-BASED sports ═══
        if (!hasSets) {
          errors.push({ matchId, error: "sets array required for this sport" });
          continue;
        }
        const setsToWin = byeFmt.setsToWin;
        let p1SetsWon = 0, p2SetsWon = 0;
        let matchDone = false;

        match.sets = [];
        match.status = "IN_PROGRESS";

        for (let i = 0; i < setScores.length && !matchDone; i++) {
          const s = setScores[i];
          const setWinner = s.player1Score > s.player2Score ? "player1" : "player2";
          const winnerData = setWinner === "player1" ? match.player1 : match.player2;

          match.sets.push({
            setNumber: i + 1,
            status: "COMPLETED",
            winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
            games: [
              {
                gameNumber: 1,
                status: "COMPLETED",
                finalScore: { player1: s.player1Score, player2: s.player2Score },
                winner: { playerId: winnerData.playerId, playerName: winnerData.playerName },
                startTime: new Date(),
                endTime: new Date(),
              },
            ],
          });

          if (setWinner === "player1") p1SetsWon++;
          else p2SetsWon++;

          if (p1SetsWon >= setsToWin || p2SetsWon >= setsToWin) matchDone = true;
        }

        // The uploaded sets must actually DECIDE the match. Without this check
        // an incomplete row (e.g. one set of a best-of-3) fell through the
        // ternary below and silently handed the match to player2 — then
        // progressed them into the next round.
        if (!matchDone) {
          errors.push({
            matchId,
            error: `Incomplete score — neither player reached ${setsToWin} set(s). ` +
              `Got ${p1SetsWon}-${p2SetsWon} from ${setScores.length} set(s).`,
          });
          // Nothing was persisted for this row: match.sets/status were only
          // mutated in memory and we never call save() on this path.
          continue;
        }

        const matchWinner = p1SetsWon >= setsToWin ? match.player1 : match.player2;
        match.status = "COMPLETED";
        match.result = {
          winner: { playerId: matchWinner.playerId, playerName: matchWinner.playerName },
          finalScore: { player1Sets: p1SetsWon, player2Sets: p2SetsWon },
          completedAt: new Date(),
        };

        // Auto-progress
        if (match.nextMatchId) {
          const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
          if (nextMatch) {
            const isOdd = match.matchNumber % 2 !== 0;
            const slot = isOdd ? "player1" : "player2";
            nextMatch[slot] = { playerId: matchWinner.playerId, playerName: matchWinner.playerName };
            await nextMatch.save({ validateModifiedOnly: true });
          }
        }

        await match.save({ validateModifiedOnly: true });

        results.push({
          matchId: match.matchId,
          player1: match.player1.playerName,
          player2: match.player2.playerName,
          winner: matchWinner.playerName,
          finalScore: `${p1SetsWon}-${p2SetsWon}`,
        });
      } catch (matchErr) {
        errors.push({ matchId, error: matchErr.message });
      }
    }

    return res.json({
      success: true,
      message: `${results.length} matches scored, ${errors.length} errors`,
      results,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Give BYE to a player in a match — the other player auto-advances
const giveBye = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { byePlayerId } = req.body; // The player who gets the BYE (loses/withdraws)

    if (!matchId || !byePlayerId) {
      return res.status(400).json({ success: false, message: "matchId and byePlayerId are required" });
    }

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) return res.status(404).json({ success: false, message: "Match not found" });
    if (match.status === "COMPLETED") return res.status(400).json({ success: false, message: "Match is already completed" });

    // Determine winner (the other player)
    const p1Id = match.player1?.playerId ? match.player1.playerId.toString() : null;
    const p2Id = match.player2?.playerId ? match.player2.playerId.toString() : null;
    const p1Name = match.player1?.playerName || "";
    const p2Name = match.player2?.playerName || "";
    const byeId = byePlayerId.toString();

    let winner, loser;
    // Match by ID or by name (fallback if playerId was not stored as ObjectId)
    if (p1Id === byeId || p1Name === byeId) {
      winner = match.player2;
      loser = match.player1;
    } else if (p2Id === byeId || p2Name === byeId) {
      winner = match.player1;
      loser = match.player2;
    } else {
      return res.status(400).json({
        success: false,
        message: "byePlayerId does not match either player in this match",
        debug: { byeId, p1Id, p2Id, p1Name, p2Name },
      });
    }

    // "Empty" means no real opponent — an unfilled TBD slot or a BYE
    // placeholder. It does NOT mean a null playerId: guest-booking tournaments
    // (manager Excel upload, no user accounts) legitimately store every player
    // with playerId: null and identify them by name, exactly as the
    // progression logic already does.
    const winnerName = (winner?.playerName || "").trim();
    const winnerIsReal = !!winnerName && winnerName !== "TBD" && winnerName !== "BYE";
    if (!winnerIsReal) {
      return res.status(400).json({ success: false, message: "Cannot give BYE — the other player slot is empty" });
    }

    // Complete match with BYE
    match.status = "COMPLETED";
    match.result = {
      winner: { playerId: winner.playerId, playerName: winner.playerName },
      finalScore: { player1Sets: 0, player2Sets: 0 },
      matchDuration: 0,
      completedAt: new Date(),
    };
    match.notes = `BYE — ${loser.playerName} withdrew. ${winner.playerName} advances.`;

    // Auto-progress winner to next match
    if (match.nextMatchId) {
      const nextMatch = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
      if (nextMatch) {
        const isOdd = match.matchNumber % 2 !== 0;
        const slot = isOdd ? "player1" : "player2";
        nextMatch[slot] = { playerId: winner.playerId, playerName: winner.playerName };
        await nextMatch.save({ validateModifiedOnly: true });
      }
    }

    await match.save({ validateModifiedOnly: true });

    return res.json({
      success: true,
      message: `BYE given to ${loser.playerName}. ${winner.playerName} advances.`,
      match: {
        matchId: match.matchId,
        status: match.status,
        winner: winner.playerName,
        byePlayer: loser.playerName,
        nextMatchId: match.nextMatchId,
      },
    });
  } catch (err) {
    console.error("[DK_BYE] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Third-place play-off ─────────────────────────────────────────────────
//
// Optional extra match between the two semi-final losers, whose winner takes
// 3rd place. Created on demand rather than during generation: it is the
// manager's choice, and the two entrants aren't known until both semis finish.
//
// Terminal by construction — no nextMatchId — so it scores through the normal
// completeGame / bulk-upload paths without progressing anyone.

// The loser of a completed match, or null if it can't be determined (a BYE, or
// a winner that matches neither slot).
const loserOfMatch = (match) => {
  const winner = match.result?.winner || match.matchResult?.winner;
  if (!winner) return null;
  const wId = winner.playerId ? String(winner.playerId) : null;
  const wName = winner.playerName || null;

  const isWinner = (p) => {
    if (!p) return false;
    if (wId && p.playerId && String(p.playerId) === wId) return true;
    return !!wName && p.playerName === wName;
  };

  const other = isWinner(match.player1) ? match.player2
    : isWinner(match.player2) ? match.player1
    : null;
  return isRealEntrant(other) ? other : null;
};

const createThirdPlaceMatch = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.body?.sportId || req.query?.sportId || null;
    const category = normalizeBracketCategory(req.body?.category ?? req.query?.category);
    const scope = bracketFilter(tournamentId, sportId, category);

    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const bracket = await DirectKnockoutMatch.find(scope);
    if (bracket.length === 0) {
      return res.status(404).json({ success: false, message: "No bracket found for this sport/category." });
    }

    const existing = bracket.find((m) => m.round === "third-place");
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A third-place match already exists for this bracket.",
        matchId: existing.matchId,
      });
    }

    // Semi-finals are the round below the deepest one. Derive the depth from
    // the bracket itself rather than assuming a draw size — and ignore any
    // third-place match when measuring (it shares the final's roundNumber).
    const mainRounds = bracket.filter((m) => m.round !== "third-place");
    const totalRounds = Math.max(...mainRounds.map((m) => m.roundNumber));
    const semis = mainRounds
      .filter((m) => m.roundNumber === totalRounds - 1)
      .sort((a, b) => a.matchNumber - b.matchNumber);

    if (semis.length !== 2) {
      return res.status(400).json({
        success: false,
        message:
          "This bracket has no semi-final round, so there is no third place to play for. " +
          "A third-place match needs a draw of 4 or more.",
      });
    }

    const unfinished = semis.filter((m) => String(m.status).toUpperCase() !== "COMPLETED");
    if (unfinished.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Both semi-finals must be completed first (${unfinished.length} still pending).`,
        pending: unfinished.map((m) => m.matchId),
      });
    }

    const losers = semis.map(loserOfMatch);
    if (losers.some((l) => !l)) {
      return res.status(400).json({
        success: false,
        message:
          "Could not determine both semi-final losers — a semi may have been decided by a BYE, " +
          "which leaves no opponent to play for third place.",
      });
    }

    // The play-off belongs to the SAME bracket as its semi-finals, so derive
    // the category from the semis rather than trusting the request body. A null
    // or omitted request category (e.g. created from an "All categories" view)
    // would otherwise store the play-off uncategorised — so per-category lookup
    // (delete / scoping) could never find it, and two categories' play-offs
    // would collide on the same matchId. semis[0].category is authoritative.
    const bracketCategory = semis[0]?.category ?? category;

    // Schedule: default to just after the final on the same court, so the
    // play-off doesn't collide with it. Overridable from the request.
    const final = mainRounds.find((m) => m.roundNumber === totalRounds);
    const gapMinutes = Number(req.body?.gapMinutes);
    const gapMs = (Number.isFinite(gapMinutes) && gapMinutes >= 0 ? gapMinutes : 0) * 60000;
    let startTime = req.body?.matchStartTime ? new Date(req.body.matchStartTime) : null;
    if (!startTime || isNaN(startTime.getTime())) {
      startTime = final?.matchStartTime ? new Date(new Date(final.matchStartTime).getTime() + gapMs) : new Date();
    }
    const durationMs = final?.matchStartTime && final?.matchEndTime
      ? new Date(final.matchEndTime).getTime() - new Date(final.matchStartTime).getTime()
      : 45 * 60000;

    const _sportId = sportId || final?.sportId || bracket[0].sportId;
    const key = bracketKey(_sportId, bracketCategory);
    // Shares the final's roundNumber but takes matchNumber 2, so the generated
    // matchId cannot collide with the final's.
    const matchId = `DK-${tournamentId}${key}-R${totalRounds}-M2`;

    const doc = createKnockoutMatch({
      tournament,
      tournamentId,
      sportId: _sportId,
      matchId,
      round: "third-place",
      roundNumber: totalRounds,
      matchNumber: 2,
      player1: { playerId: losers[0].playerId || null, playerName: losers[0].playerName },
      player2: { playerId: losers[1].playerId || null, playerName: losers[1].playerName },
      courtNumber: req.body?.courtNumber || final?.courtNumber || "1",
      matchStartTime: startTime,
      matchEndTime: new Date(startTime.getTime() + durationMs),
      // Terminal — nobody advances out of a third-place play-off.
      nextMatchId: null,
      bracketPosition: `R${totalRounds}M2`,
      category: bracketCategory,
      // Match the final's format so the play-off is played to the same length.
      matchFormatOverride: final?.matchFormat
        ? { totalSets: final.matchFormat.totalSets, setsToWin: final.matchFormat.setsToWin }
        : null,
    });

    const [saved] = await DirectKnockoutMatch.insertMany([doc]);

    return res.status(201).json({
      success: true,
      message: `Third-place match created: ${losers[0].playerName} vs ${losers[1].playerName}`,
      match: saved,
    });
  } catch (err) {
    console.error("[DK_THIRD_PLACE] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Remove the third-place play-off (manager changed their mind). Only allowed
// while it is still unplayed — a completed play-off should be reopened first,
// so clearing a real result is always a deliberate, separate act.
const deleteThirdPlaceMatch = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.body?.sportId || req.query?.sportId || null;
    const category = normalizeBracketCategory(req.body?.category ?? req.query?.category);

    const match = await DirectKnockoutMatch.findOne({
      ...bracketFilter(tournamentId, sportId, category),
      round: "third-place",
    });
    if (!match) {
      return res.status(404).json({ success: false, message: "No third-place match for this bracket." });
    }
    if (String(match.status).toUpperCase() === "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "This third-place match has been played. Reopen it first if you want to remove it.",
      });
    }

    await DirectKnockoutMatch.deleteOne({ _id: match._id });
    return res.json({ success: true, message: "Third-place match removed." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Reopen a completed match (re-score / undo) ───────────────────────────
//
// Until now a completed match was final: completeGame rejects anything already
// COMPLETED and there was no correction path, so one mistyped score meant
// resetting the entire bracket and re-entering every result.
//
// Undo is not just "clear the result" — completing a match ALSO advances the
// winner into the next round. So reopening must retract that too, and if the
// next match has already been played then its result was produced by a player
// who may not belong there. Those downstream results are therefore invalidated
// as well, which is destructive enough to require an explicit opt-in
// (`cascade: true`) rather than happening silently.

// A slot holds a real entrant (not an unfilled TBD or an empty-draw BYE).
const isRealEntrant = (p) => {
  const n = p?.playerName;
  return !!n && n !== "TBD" && n !== "BYE";
};

// Clear this match's winner out of its next-round slot. Only clears when the
// slot actually holds this winner — never clobbers an unrelated entrant.
const retractWinnerFromNext = async (match) => {
  if (!match.nextMatchId) return null;
  const next = await DirectKnockoutMatch.findOne({ matchId: match.nextMatchId });
  if (!next) return null;

  const slot = match.matchNumber % 2 !== 0 ? "player1" : "player2";
  const winner = match.result?.winner || match.matchResult?.winner;
  if (!winner) return null;

  const occupant = next[slot];
  const sameId =
    winner.playerId && occupant?.playerId &&
    String(occupant.playerId) === String(winner.playerId);
  const sameName =
    winner.playerName && occupant?.playerName === winner.playerName;
  if (!sameId && !sameName) return null; // someone else is there — leave it

  next[slot] = { playerId: null, playerName: "TBD" };
  await next.save({ validateModifiedOnly: true });
  return next.matchId;
};

// Wipe a match back to an unplayed state, in place. Caller saves.
const clearMatchResult = (match) => {
  match.status = "SCHEDULED";
  match.result = {
    winner: { playerId: null, playerName: null },
    finalScore: { player1Sets: 0, player2Sets: 0 },
    matchDuration: 0,
    completedAt: null,
  };
  match.matchResult = null;
  match.sets = [];
  match.currentSet = 1;
  match.currentGame = 1;
  match.liveScore = { player1Points: 0, player2Points: 0 };
  // Drop the auto-generated BYE note; a manager's own note is left alone.
  if (typeof match.notes === "string" && match.notes.startsWith("BYE —")) {
    match.notes = "";
  }
};

// Walk forward from `match`, collecting the matches its result feeds. Stops at
// the first unplayed match — nothing beyond that depends on this result.
const collectDownstream = async (match) => {
  const chain = [];
  let cur = match;
  const guard = new Set([match.matchId]); // cycle safety on malformed data
  while (cur?.nextMatchId && !guard.has(cur.nextMatchId)) {
    guard.add(cur.nextMatchId);
    const next = await DirectKnockoutMatch.findOne({ matchId: cur.nextMatchId });
    if (!next) break;
    chain.push(next);
    if (String(next.status).toUpperCase() !== "COMPLETED") break;
    cur = next;
  }
  return chain;
};

const reopenMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const cascade = req.body?.cascade === true;

    const match = await DirectKnockoutMatch.findOne({ matchId });
    if (!match) {
      return res.status(404).json({ success: false, message: "Match not found" });
    }
    if (String(match.status).toUpperCase() !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Only a completed match can be reopened.",
      });
    }
    // An automatic BYE has no opponent to play — reopening it would just leave
    // a match that can never be completed and stalls the round above it.
    if (!isRealEntrant(match.player1) || !isRealEntrant(match.player2)) {
      return res.status(400).json({
        success: false,
        message:
          "This match was decided by an automatic BYE — there is no opponent to play. " +
          "Regenerate the bracket to change it.",
      });
    }

    const downstream = await collectDownstream(match);
    const played = downstream.filter(
      (m) => String(m.status).toUpperCase() === "COMPLETED"
    );

    if (played.length > 0 && !cascade) {
      return res.status(409).json({
        success: false,
        cascadeRequired: true,
        message:
          `${played.length} later match(es) have already been played using this result. ` +
          `Reopening this match will clear them too. Re-submit with { cascade: true } to confirm.`,
        affectedMatches: played.map((m) => ({
          matchId: m.matchId,
          round: m.round,
          matchNumber: m.matchNumber,
          player1: m.player1?.playerName,
          player2: m.player2?.playerName,
          winner: m.result?.winner?.playerName || null,
        })),
      });
    }

    // Clear deepest-first so each match's winner is retracted from a slot that
    // still exists in a known state.
    const reopened = [];
    for (const m of [...played].reverse()) {
      await retractWinnerFromNext(m);
      clearMatchResult(m);
      await m.save({ validateModifiedOnly: true });
      reopened.push(m.matchId);
    }

    await retractWinnerFromNext(match);
    clearMatchResult(match);
    await match.save({ validateModifiedOnly: true });
    reopened.push(match.matchId);

    return res.json({
      success: true,
      message:
        reopened.length > 1
          ? `Reopened ${reopened.length} matches. Re-enter the scores.`
          : "Match reopened. Re-enter the score.",
      reopened,
      match: {
        matchId: match.matchId,
        status: match.status,
        player1: match.player1?.playerName,
        player2: match.player2?.playerName,
      },
    });
  } catch (err) {
    console.error("[DK_REOPEN] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Reset direct knockout bracket for a tournament.
// Multi-sport / multi-category: when a sportId (and optionally a category) is
// supplied, only that bracket is wiped so resetting one never destroys another.
const resetBracket = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const sportId = req.query.sportId || req.body?.sportId || null;
    const category = normalizeBracketCategory(req.query.category ?? req.body?.category);
    const filter = bracketFilter(tournamentId, sportId, category);
    const deleted = await DirectKnockoutMatch.deleteMany(filter);
    return res.json({
      success: true,
      message: `Deleted ${deleted.deletedCount} matches`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Edit player name in a match
const updatePlayerName = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { playerSlot, playerName } = req.body;

    if (!matchId || !playerSlot || !playerName) {
      return res.status(400).json({
        success: false,
        message: "matchId, playerSlot ('player1' or 'player2'), and playerName are required",
      });
    }

    const match = await DirectKnockoutMatch.findOne({
      $or: [
        { matchId },
        { _id: mongoose.Types.ObjectId.isValid(matchId) ? matchId : undefined },
      ].filter(Boolean),
    });

    if (!match) {
      return res.status(404).json({ success: false, message: "Match not found" });
    }

    if (!match[playerSlot]) {
      match[playerSlot] = {};
    }
    match[playerSlot].playerName = playerName.trim();
    match.markModified(playerSlot);
    await match.save({ validateModifiedOnly: true });

    return res.json({
      success: true,
      message: `Updated player name to "${playerName.trim()}"`,
      match,
    });
  } catch (err) {
    console.error("[DK_UPDATE_PLAYER] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Swap two players between bracket slots (drag-and-drop on the bracket).
 *
 * WHY THIS IS NOT updatePlayerName
 * --------------------------------
 * updatePlayerName rewrites `playerName` and nothing else — it is a LABEL edit,
 * which is the right shape for fixing a typo. A drag-and-drop swap must move
 * the whole slot including `playerId`, or the bracket's identity linkage rots:
 * progression, standings and result attribution all key on playerId, so a
 * name-only swap would show one player in the slot while the system still
 * advanced the other.
 *
 * SAFETY RULES (all enforced here, none trusted to the client)
 *   • Both matches must belong to the SAME tournament. The router.param
 *     ("matchId") guard covers the SOURCE match's ownership; without this check
 *     a manager could name a target match in a tournament they do not own and
 *     pull a player across tenants.
 *   • Neither match may be IN_PROGRESS or COMPLETED. Swapping a player out of a
 *     live or finished match would invalidate a real result and any progression
 *     already written from it.
 *   • The write is transactional when two different matches are involved —
 *     a half-applied swap would duplicate one player and lose another.
 *
 * Dropping onto an empty ("TBD") slot is a MOVE: the swap simply carries the
 * placeholder back the other way, which is the behaviour a manager expects.
 */
const SWAPPABLE_STATUSES = ["SCHEDULED", "CANCELLED"];

const findDkMatch = (id) =>
  DirectKnockoutMatch.findOne({
    $or: [
      { matchId: id },
      { _id: mongoose.Types.ObjectId.isValid(id) ? id : undefined },
    ].filter(Boolean),
  });

const swapPlayers = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { fromSlot, toMatchId, toSlot } = req.body;

    const SLOTS = ["player1", "player2"];
    if (!SLOTS.includes(fromSlot) || !SLOTS.includes(toSlot)) {
      return res.status(400).json({
        success: false,
        message: "fromSlot and toSlot must be 'player1' or 'player2'",
      });
    }
    if (!toMatchId) {
      return res.status(400).json({ success: false, message: "toMatchId is required" });
    }

    const sourceMatch = await findDkMatch(matchId);
    if (!sourceMatch) {
      return res.status(404).json({ success: false, message: "Source match not found" });
    }

    const sameMatch = String(toMatchId) === String(matchId)
      || String(toMatchId) === String(sourceMatch._id)
      || String(toMatchId) === String(sourceMatch.matchId);

    const targetMatch = sameMatch ? sourceMatch : await findDkMatch(toMatchId);
    if (!targetMatch) {
      return res.status(404).json({ success: false, message: "Target match not found" });
    }

    // Cross-tournament guard. The param guard authorised the SOURCE tournament
    // only; the target must be the same one.
    if (String(sourceMatch.tournamentId) !== String(targetMatch.tournamentId)) {
      return res.status(403).json({
        success: false,
        message: "Both matches must belong to the same tournament",
      });
    }

    // Swapping into or out of a live/finished match would invalidate a real
    // result and anything already progressed from it.
    for (const m of sameMatch ? [sourceMatch] : [sourceMatch, targetMatch]) {
      if (!SWAPPABLE_STATUSES.includes(m.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot move players in a match that is ${m.status}. Reset the match first.`,
          matchId: m.matchId || String(m._id),
          status: m.status,
        });
      }
    }

    if (sameMatch && fromSlot === toSlot) {
      return res.status(400).json({ success: false, message: "Source and target are the same slot" });
    }

    // Deep-copy the whole slot — playerId AND playerName travel together.
    const plain = (slot) => ({
      playerId: slot?.playerId || undefined,
      playerName: slot?.playerName || "TBD",
    });

    const sourcePlayer = plain(sourceMatch[fromSlot]);
    const targetPlayer = plain(targetMatch[toSlot]);

    if (sameMatch) {
      sourceMatch[fromSlot] = targetPlayer;
      sourceMatch[toSlot] = sourcePlayer;
      sourceMatch.markModified(fromSlot);
      sourceMatch.markModified(toSlot);
      await sourceMatch.save({ validateModifiedOnly: true });
    } else {
      sourceMatch[fromSlot] = targetPlayer;
      targetMatch[toSlot] = sourcePlayer;
      sourceMatch.markModified(fromSlot);
      targetMatch.markModified(toSlot);

      // Both writes land or neither does — a half-applied swap would duplicate
      // one player into two slots and drop the other entirely.
      const { runInTransaction } = require("../src/platform/db");
      await runInTransaction(async (session) => {
        await sourceMatch.save({ validateModifiedOnly: true, session });
        await targetMatch.save({ validateModifiedOnly: true, session });
      });
    }

    return res.json({
      success: true,
      message: `Moved ${sourcePlayer.playerName} ↔ ${targetPlayer.playerName}`,
      matches: sameMatch ? [sourceMatch] : [sourceMatch, targetMatch],
    });
  } catch (err) {
    console.error("[DK_SWAP_PLAYERS] Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  // Original (post-group stage)
  validatePlayerSelection,
  createDirectKnockoutMatches,
  getDirectKnockoutMatches,
  progressWinnerToNextMatch,
  processDirectKnockoutProgression,

  // Standalone mode
  validateStandalonePlayers,
  createStandaloneKnockout,

  // Live scoring
  completeGame,
  bulkUploadScores,
  giveBye,
  reopenMatch,
  createThirdPlaceMatch,
  deleteThirdPlaceMatch,
  resetBracket,
  updatePlayerName,
  swapPlayers,

  // Utilities
  isPowerOfTwo,
  getValidTournamentSizes,
};