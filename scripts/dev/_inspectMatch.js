require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("../../src/modules/tournaments/models/Tournnamentmatch");
const Tournament = require("../../src/modules/tournaments/models/Tournament");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const ts = await Tournament.find({ title: /MULTI-SPORT|MANAGER FLOW/i }).select("_id title").lean();
  for (const t of ts) {
    console.log(`\n=== ${t.title} (${t._id}) ===`);
    const matches = await Match.find({ tournamentId: t._id, sportName: "Cricket" }).lean();
    for (const m of matches) {
      const inns = m.result?.innings || m.liveScore?.innings || [];
      console.log(`M${m.matchNumber} court=${m.courtNumber} ${m.player1?.userName} vs ${m.player2?.userName} [${m.status}]`);
      inns.forEach((i) =>
        console.log(`   inn${i.inningsNumber} ${i.runs}/${i.wickets}  deliveries=${(i.deliveries || []).length}  battingOrder=${(i.battingOrder || []).length}`)
      );
      const mrDel = (m.matchResult?.details || []).map((d) => (d.deliveries || []).length);
      console.log(`   matchResult.details deliveries=${JSON.stringify(mrDel)}`);
    }
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
