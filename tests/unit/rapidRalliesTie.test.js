/**
 * Unit tests for Rapid Rallies tie assembly + completion (pure).
 */
const {
  slotMapFromTeam,
  buildRapidRalliesSets,
  decideTieOutcome,
} = require("../../utils/rapidRalliesTie");

const homeTeam = {
  roster: [
    { position: "P1", name: "Aarav", gender: "male" },
    { position: "P2", name: "Vivaan", gender: "male" },
    { position: "P3", name: "Isha", gender: "female" },
    { position: "P4", name: "Kabir", gender: "male" },
    { position: "P5", name: "Rohan", gender: "male" },
  ],
};
const awayTeam = {
  roster: [
    { position: "P1", name: "Bob", gender: "male" },
    { position: "P2", name: "Carl", gender: "male" },
    { position: "P3", name: "Diya", gender: "female" },
    { position: "P4", name: "Eshan", gender: "male" },
    { position: "P5", name: "Farhan", gender: "male" },
  ],
};

describe("slotMapFromTeam", () => {
  test("maps roster positions to names", () => {
    expect(slotMapFromTeam(homeTeam)).toEqual({
      P1: "Aarav", P2: "Vivaan", P3: "Isha", P4: "Kabir", P5: "Rohan",
    });
  });
});

describe("buildRapidRalliesSets", () => {
  const home = slotMapFromTeam(homeTeam);
  const away = slotMapFromTeam(awayTeam);

  test("builds 5 rubbers with correct fixed matchups", () => {
    const sets = buildRapidRalliesSets(home, away);
    expect(sets).toHaveLength(5);
    // Rubber 1: home P1 vs away P2 (cross-seed)
    expect(sets[0]).toMatchObject({ setNumber: 1, homePlayer: "Aarav", awayPlayer: "Carl" });
    // Rubber 3: female P3 vs P3
    expect(sets[2]).toMatchObject({ setNumber: 3, homePlayer: "Isha", awayPlayer: "Diya" });
  });

  test("doubles rubbers carry anchor + partner and require selection", () => {
    const sets = buildRapidRalliesSets(home, away);
    // Rubber 2 anchor home P2=Vivaan, away P1=Bob; default partner P3
    expect(sets[1].homePlayer).toBe("Vivaan");
    expect(sets[1].awayPlayer).toBe("Bob");
    expect(sets[1].homePlayerB).toBe("Isha"); // default partner P3
    expect(sets[1].selectionId).toBeNull();
    // Rubber 4 anchor home P1=Aarav, away P2=Carl
    expect(sets[3].homePlayer).toBe("Aarav");
    expect(sets[3].awayPlayer).toBe("Carl");
  });

  test("applies captain picks when provided", () => {
    const sets = buildRapidRalliesSets(
      home, away,
      { partner2: "P4", partner4: "P5", singles5: "P5" },
      { partner2: "P4", partner4: "P5", singles5: "P4" }
    );
    expect(sets[1].homePlayerB).toBe("Kabir"); // P4
    expect(sets[3].homePlayerB).toBe("Rohan"); // P5
    expect(sets[4].homePlayer).toBe("Rohan");  // rubber-5 home P5
    expect(sets[4].awayPlayer).toBe("Eshan");  // rubber-5 away P4
  });
});

describe("decideTieOutcome", () => {
  const mk = (winners) => winners.map((w, i) => ({ setNumber: i + 1, setWinner: w, status: w ? "COMPLETED" : "PENDING" }));

  test("playAllSets: not complete until all 5 rubbers done", () => {
    const sets = mk(["home", "home", "home", null, null]); // 3-0 but 2 unplayed
    const out = decideTieOutcome({ sets, setsToWin: 3, playAllSets: true });
    expect(out.complete).toBe(false);
  });

  test("playAllSets: complete when all done, winner = more rubbers", () => {
    const sets = mk(["home", "away", "home", "away", "home"]); // 3-2 home
    const out = decideTieOutcome({ sets, setsToWin: 3, playAllSets: true });
    expect(out).toMatchObject({ complete: true, winner: "home", homeWon: 3, awayWon: 2 });
  });

  test("legacy (no playAllSets): completes early at setsToWin (dead rubbers)", () => {
    const sets = mk(["home", "home", "home", null, null]);
    const out = decideTieOutcome({ sets, setsToWin: 3, playAllSets: false });
    expect(out).toMatchObject({ complete: true, winner: "home" });
  });
});
