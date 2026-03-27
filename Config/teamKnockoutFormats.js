/**
 * Server-side Team Knockout Format Registry.
 * Single source of truth — identical to frontend config.
 * All match generation uses this directly. No legacy mapping.
 */

const TEAM_KNOCKOUT_FORMATS = [
  // 2-Player Singles
  {
    id: "singles_bo3", name: "Singles — Best of 3", totalSets: 3, setsToWin: 2, hasDoubles: false, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["A"], awayPos: ["B"], isDecider: true },
    ],
  },
  {
    id: "singles_bo5", name: "Singles — Best of 5", totalSets: 5, setsToWin: 3, hasDoubles: false, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 4, type: "singles", homePos: ["B"], awayPos: ["A"] },
      { setNumber: 5, type: "singles", homePos: ["A"], awayPos: ["A"], isDecider: true },
    ],
  },
  {
    id: "singles_bo7", name: "Singles — Best of 7", totalSets: 7, setsToWin: 4, hasDoubles: false, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 4, type: "singles", homePos: ["B"], awayPos: ["A"] },
      { setNumber: 5, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 6, type: "singles", homePos: ["B"], awayPos: ["B"], isDecider: true },
      { setNumber: 7, type: "singles", homePos: ["A"], awayPos: ["B"], isDecider: true },
    ],
  },
  // 2-Player Doubles (Mixed)
  {
    id: "doubles_bo3", name: "Doubles — Best of 3", totalSets: 3, setsToWin: 2, hasDoubles: true, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "doubles", homePos: ["A", "B"], awayPos: ["A", "B"] },
      { setNumber: 3, type: "singles", homePos: ["B"], awayPos: ["B"], isDecider: true },
    ],
  },
  {
    id: "doubles_bo5", name: "Doubles — Best of 5", totalSets: 5, setsToWin: 3, hasDoubles: true, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "doubles", homePos: ["A", "B"], awayPos: ["A", "B"] },
      { setNumber: 4, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 5, type: "singles", homePos: ["B"], awayPos: ["A"], isDecider: true },
    ],
  },
  {
    id: "doubles_bo7", name: "Doubles — Best of 7", totalSets: 7, setsToWin: 4, hasDoubles: true, minPlayers: 2,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "doubles", homePos: ["A", "B"], awayPos: ["A", "B"] },
      { setNumber: 4, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 5, type: "singles", homePos: ["B"], awayPos: ["A"] },
      { setNumber: 6, type: "doubles", homePos: ["A", "B"], awayPos: ["A", "B"], isDecider: true },
      { setNumber: 7, type: "singles", homePos: ["A"], awayPos: ["A"], isDecider: true },
    ],
  },
  // 3-Player Singles
  {
    id: "singles_3p_bo3", name: "3-Player Singles — Best of 3", totalSets: 3, setsToWin: 2, hasDoubles: false, minPlayers: 3,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["C"], awayPos: ["C"], isDecider: true },
    ],
  },
  {
    id: "singles_3p_bo5", name: "3-Player Singles — Best of 5", totalSets: 5, setsToWin: 3, hasDoubles: false, minPlayers: 3,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["C"], awayPos: ["C"] },
      { setNumber: 4, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 5, type: "singles", homePos: ["B"], awayPos: ["C"], isDecider: true },
    ],
  },
  // 3-Player Mixed (Doubles with captain selection)
  {
    id: "doubles_3p_bo5", name: "3-Player Mixed — Best of 5", totalSets: 5, setsToWin: 3, hasDoubles: true, minPlayers: 3,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      {
        setNumber: 3, type: "doubles", isDecider: false,
        requiresSelection: true,
        defaultHomePos: ["B", "C"], defaultAwayPos: ["A", "B"],
        options: [
          { id: "bc_ab", homePos: ["B", "C"], awayPos: ["A", "B"] },
          { id: "ab_bc", homePos: ["A", "B"], awayPos: ["B", "C"] },
          { id: "ac_ac", homePos: ["A", "C"], awayPos: ["A", "C"] },
        ],
      },
      { setNumber: 4, type: "singles", homePos: ["A"], awayPos: ["B"] },
      { setNumber: 5, type: "singles", homePos: ["C"], awayPos: ["C"], isDecider: true },
    ],
  },
  {
    id: "doubles_3p_bo7", name: "3-Player Mixed — Best of 7", totalSets: 7, setsToWin: 4, hasDoubles: true, minPlayers: 3,
    sets: [
      { setNumber: 1, type: "singles", homePos: ["A"], awayPos: ["A"] },
      { setNumber: 2, type: "singles", homePos: ["B"], awayPos: ["B"] },
      { setNumber: 3, type: "singles", homePos: ["C"], awayPos: ["C"] },
      {
        setNumber: 4, type: "doubles", isDecider: false,
        requiresSelection: true,
        defaultHomePos: ["A", "B"], defaultAwayPos: ["A", "B"],
        options: [
          { id: "ab_ab", homePos: ["A", "B"], awayPos: ["A", "B"] },
          { id: "ac_ac", homePos: ["A", "C"], awayPos: ["A", "C"] },
          { id: "bc_bc", homePos: ["B", "C"], awayPos: ["B", "C"] },
        ],
      },
      { setNumber: 5, type: "singles", homePos: ["A"], awayPos: ["B"] },
      {
        setNumber: 6, type: "doubles", isDecider: true,
        requiresSelection: true,
        defaultHomePos: ["B", "C"], defaultAwayPos: ["A", "B"],
        options: [
          { id: "bc_ab2", homePos: ["B", "C"], awayPos: ["A", "B"] },
          { id: "ac_bc2", homePos: ["A", "C"], awayPos: ["B", "C"] },
          { id: "ab_ac2", homePos: ["A", "B"], awayPos: ["A", "C"] },
        ],
      },
      { setNumber: 7, type: "singles", homePos: ["B"], awayPos: ["C"], isDecider: true },
    ],
  },
];

/**
 * Get format by ID.
 */
function getFormat(formatId) {
  const f = TEAM_KNOCKOUT_FORMATS.find((fmt) => fmt.id === formatId);
  if (!f) throw new Error(`Unknown team knockout format: "${formatId}"`);
  return f;
}

/**
 * Get all format IDs (for validation).
 */
function getAllFormatIds() {
  return TEAM_KNOCKOUT_FORMATS.map((f) => f.id);
}

/**
 * Resolve set players from team rosters.
 * Handles both fixed sets and requiresSelection sets.
 *
 * @param {object} setDef — set definition from format
 * @param {object} homeTeam — { playerPositions: { A, B, C } }
 * @param {object} awayTeam — { playerPositions: { A, B, C } }
 * @param {string|null} selectionId — captain's choice for doubles
 * @returns {{ homePlayer, awayPlayer, homePlayerB, awayPlayerB, type, setNumber }}
 */
function resolveSetPlayers(setDef, homeTeam, awayTeam, selectionId = null) {
  let homePos, awayPos;

  if (setDef.requiresSelection && selectionId) {
    const option = (setDef.options || []).find((o) => o.id === selectionId);
    if (option) {
      homePos = option.homePos;
      awayPos = option.awayPos;
    }
  }

  if (!homePos) homePos = setDef.requiresSelection ? setDef.defaultHomePos : setDef.homePos;
  if (!awayPos) awayPos = setDef.requiresSelection ? setDef.defaultAwayPos : setDef.awayPos;

  const hp = homeTeam?.playerPositions || {};
  const ap = awayTeam?.playerPositions || {};

  const result = {
    setNumber: setDef.setNumber,
    type: setDef.type === "doubles"
      ? `Doubles ${homePos.join("")}-${awayPos.join("")}`
      : `Singles ${homePos[0]}-${awayPos[0]}`,
    homePlayer: hp[homePos[0]] || null,
    awayPlayer: ap[awayPos[0]] || null,
    homePlayerB: homePos[1] ? (hp[homePos[1]] || null) : null,
    awayPlayerB: awayPos[1] ? (ap[awayPos[1]] || null) : null,
    status: "PENDING",
    games: [],
    gamesWon: { home: 0, away: 0 },
    setWinner: null,
  };

  return result;
}

module.exports = {
  TEAM_KNOCKOUT_FORMATS,
  getFormat,
  getAllFormatIds,
  resolveSetPlayers,
};
