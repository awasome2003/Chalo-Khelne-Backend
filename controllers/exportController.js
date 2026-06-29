// Reports & Export — tournament participants (CSV) and results (CSV / XLSX / PDF).
// Routes are mounted in tournamentRoutes.js and gated by
// `allowUserOrManager` + `requireTournamentOwner` so only the tournament's
// managers/clubadmin/superadmin can download.
//
// Results exports cover ALL formats — group standings, individual knockout,
// and team knockout — plus a champion/runner-up/third-place podium for each
// bracket. The data is gathered once by utils/tournamentResults so CSV, XLSX
// and PDF stay consistent.

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const Booking = require("../src/modules/tournaments/models/BookingModel");
const Tournament = require("../src/modules/tournaments/models/Tournament");
const { gatherTournamentResults } = require("../utils/tournamentResults");

// Properly escape a value for a single CSV cell.
function csvCell(s) {
  const v = String(s ?? "");
  if (v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function slugForFilename(s) {
  return String(s || "tournament")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tournament";
}

function dateRange(t) {
  return [t.startDate, t.endDate]
    .filter(Boolean)
    .map((d) => new Date(d).toLocaleDateString("en-IN"))
    .join(" — ");
}

// Excel sheet names: ≤31 chars, no \ / ? * [ ] : , and unique within the book.
function uniqueSheetName(base, used) {
  let name = String(base || "Sheet").replace(/[\\/\?\*\[\]:]/g, "-").slice(0, 28) || "Sheet";
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) candidate = `${name} ${i++}`.slice(0, 31);
  used.add(candidate);
  return candidate;
}

// GET /api/tournaments/:tournamentId/export/participants.csv
exports.exportParticipantsCsv = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const tournament = await Tournament.findById(tournamentId).select("title").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }
    const bookings = await Booking.find({ tournamentId })
      .populate("userId", "name email mobile")
      .sort({ createdAt: 1 })
      .lean();

    const header = [
      "Name",
      "Email",
      "Mobile",
      "Category",
      "Status",
      "Payment Status",
      "Registered At",
    ];
    const rows = [header.map(csvCell).join(",")];
    for (const b of bookings) {
      const u = b.userId || {};
      rows.push(
        [
          u.name || b.userName || "",
          u.email || "",
          u.mobile || "",
          b.category || (b.sportSelections && b.sportSelections[0]?.category) || "",
          b.status || "",
          b.paymentStatus || "",
          b.createdAt ? new Date(b.createdAt).toISOString() : "",
        ]
          .map(csvCell)
          .join(",")
      );
    }
    const csv = rows.join("\r\n");
    const filename = `participants-${slugForFilename(tournament.title)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM helps Excel open UTF-8 CSV cleanly.
    res.send("﻿" + csv);
  } catch (err) {
    console.error("[EXPORT] participants csv:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tournaments/:tournamentId/export/results.csv
exports.exportResultsCsv = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const results = await gatherTournamentResults(tournamentId);
    if (!results) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const rows = [];
    const push = (...cells) => rows.push(cells.map(csvCell).join(","));

    push("Tournament Results");
    push("Tournament", results.tournament.title);
    push("Generated", results.generatedAt.toISOString());
    if (dateRange(results.tournament)) push("Dates", dateRange(results.tournament));
    rows.push("");

    if (!results.hasAnyResults) {
      push("No results recorded yet for this tournament.");
      sendCsv(res, rows, results.tournament.title);
      return;
    }

    // ── Champions / podium ──
    const podiums = results.brackets.filter((b) => b.podium);
    if (podiums.length) {
      push("CHAMPIONS");
      push("Sport", "Format", "Champion", "Runner-up", "Third Place");
      for (const b of podiums) {
        push(
          b.sportName,
          b.kind === "team" ? "Team Knockout" : "Knockout",
          b.podium.champion || "",
          b.podium.runnerUp || "",
          (b.podium.thirdPlace || []).join(" / ")
        );
      }
      rows.push("");
    }

    // ── Group standings ──
    if (results.groups.length) {
      push("GROUP STANDINGS");
      for (const g of results.groups) {
        push("Group", g.groupName);
        push("Rank", "Player", "Played", "Won", "Lost", "Drawn", "For", "Against", "Points");
        g.standings.forEach((p, i) => {
          push(
            i + 1,
            p.playerName || "",
            p.played || 0,
            p.won || 0,
            p.lost || 0,
            p.drawn || 0,
            p.scoreFor || 0,
            p.scoreAgainst || 0,
            p.totalPoints || 0
          );
        });
        rows.push("");
      }
    }

    // ── Knockout brackets ──
    const bracketsWithRounds = results.brackets.filter((b) => b.rounds.length);
    if (bracketsWithRounds.length) {
      push("KNOCKOUT RESULTS");
      for (const b of bracketsWithRounds) {
        const who = b.kind === "team" ? "Team" : "Player";
        push(`${b.sportName} (${b.kind === "team" ? "Team Knockout" : "Knockout"})`);
        push("Round", "Match", `${who} 1`, `${who} 2`, "Winner", "Score", "Status");
        for (const round of b.rounds) {
          round.matches.forEach((m, i) => {
            push(round.label, i + 1, m.p1, m.p2, m.winner || "", m.score || "", m.status || "");
          });
        }
        rows.push("");
      }
    }

    sendCsv(res, rows, results.tournament.title);
  } catch (err) {
    console.error("[EXPORT] results csv:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

function sendCsv(res, rows, title) {
  const csv = rows.join("\r\n");
  const filename = `results-${slugForFilename(title)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + csv);
}

// GET /api/tournaments/:tournamentId/export/results.xlsx
exports.exportResultsXlsx = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const results = await gatherTournamentResults(tournamentId);
    if (!results) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Sportszz";
    wb.created = new Date();
    const usedNames = new Set();

    // ── Summary sheet (info + podium) ──
    const summary = wb.addWorksheet("Summary");
    usedNames.add("Summary");
    summary.columns = [{ width: 22 }, { width: 24 }, { width: 26 }, { width: 26 }, { width: 30 }];
    summary.addRow(["Tournament", results.tournament.title]);
    summary.addRow(["Generated", results.generatedAt.toLocaleString("en-IN")]);
    if (dateRange(results.tournament)) summary.addRow(["Dates", dateRange(results.tournament)]);
    summary.getRow(1).font = { bold: true };

    const podiums = results.brackets.filter((b) => b.podium);
    if (podiums.length) {
      summary.addRow([]);
      const head = summary.addRow(["Sport", "Format", "Champion", "Runner-up", "Third Place"]);
      head.font = { bold: true };
      for (const b of podiums) {
        summary.addRow([
          b.sportName,
          b.kind === "team" ? "Team Knockout" : "Knockout",
          b.podium.champion || "",
          b.podium.runnerUp || "",
          (b.podium.thirdPlace || []).join(" / "),
        ]);
      }
    }
    if (!results.hasAnyResults) {
      summary.addRow([]);
      summary.addRow(["No results recorded yet for this tournament."]);
    }

    // ── One sheet per group ──
    for (const g of results.groups) {
      const ws = wb.addWorksheet(uniqueSheetName(g.groupName, usedNames));
      ws.columns = [
        { header: "Rank", width: 6 },
        { header: "Player", width: 28 },
        { header: "Played", width: 8 },
        { header: "Won", width: 6 },
        { header: "Lost", width: 6 },
        { header: "Drawn", width: 6 },
        { header: "For", width: 8 },
        { header: "Against", width: 8 },
        { header: "Points", width: 8 },
      ];
      ws.getRow(1).font = { bold: true };
      g.standings.forEach((p, idx) => {
        ws.addRow([
          idx + 1,
          p.playerName || "",
          p.played || 0,
          p.won || 0,
          p.lost || 0,
          p.drawn || 0,
          p.scoreFor || 0,
          p.scoreAgainst || 0,
          p.totalPoints || 0,
        ]);
      });
    }

    // ── One sheet per knockout bracket ──
    for (const b of results.brackets) {
      if (!b.rounds.length) continue;
      const who = b.kind === "team" ? "Team" : "Player";
      const ws = wb.addWorksheet(uniqueSheetName(b.sportName, usedNames));
      ws.columns = [
        { header: "Round", width: 16 },
        { header: "Match", width: 7 },
        { header: `${who} 1`, width: 26 },
        { header: `${who} 2`, width: 26 },
        { header: "Winner", width: 26 },
        { header: "Score", width: 10 },
        { header: "Status", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const round of b.rounds) {
        round.matches.forEach((m, i) => {
          ws.addRow([round.label, i + 1, m.p1, m.p2, m.winner || "", m.score || "", m.status || ""]);
        });
      }
    }

    const filename = `results-${slugForFilename(results.tournament.title)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[EXPORT] results xlsx:", err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    else res.end();
  }
};

// GET /api/tournaments/:tournamentId/export/results.pdf
exports.exportResultsPdf = async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const results = await gatherTournamentResults(tournamentId);
    if (!results) {
      return res.status(404).json({ success: false, message: "Tournament not found" });
    }

    const filename = `results-${slugForFilename(results.tournament.title)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // ── Header ──
    doc.font("Helvetica-Bold").fontSize(22).text(results.tournament.title || "Tournament Results", { align: "center" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor("#666")
      .text(`Generated ${results.generatedAt.toLocaleString("en-IN")}`, { align: "center" });
    if (dateRange(results.tournament)) doc.text(dateRange(results.tournament), { align: "center" });
    doc.fillColor("#000").moveDown(1.2);

    if (!results.hasAnyResults) {
      doc.fontSize(12).text("No results recorded yet for this tournament.", { align: "center" });
      doc.end();
      return;
    }

    // ── Champions / podium ──
    const podiums = results.brackets.filter((b) => b.podium);
    if (podiums.length) {
      doc.font("Helvetica-Bold").fontSize(15).text("Champions");
      doc.moveDown(0.4);
      for (const b of podiums) {
        doc.font("Helvetica-Bold").fontSize(12).text(`${b.sportName} — ${b.kind === "team" ? "Team Knockout" : "Knockout"}`);
        doc.font("Helvetica").fontSize(11).fillColor("#000");
        doc.text(`Champion:    ${b.podium.champion || "—"}`, { indent: 16 });
        doc.text(`Runner-up:   ${b.podium.runnerUp || "—"}`, { indent: 16 });
        if ((b.podium.thirdPlace || []).length) {
          doc.text(`Third place: ${b.podium.thirdPlace.join(", ")}`, { indent: 16 });
        }
        doc.moveDown(0.6);
      }
    }

    // ── Group standings (monospace tables) ──
    if (results.groups.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(16).text("Group Standings");
      doc.moveDown(0.6);
      results.groups.forEach((g, gi) => {
        if (gi > 0) doc.moveDown(0.8);
        doc.font("Helvetica-Bold").fontSize(13).text(g.groupName);
        doc.moveDown(0.3);
        doc.font("Courier-Bold").fontSize(10);
        doc.text(" #  Player                            P    W    L    D    Pts");
        doc.text("--- --------------------------------- ---- ---- ---- ---- ----");
        doc.font("Courier").fontSize(10);
        g.standings.forEach((p, i) => {
          const rank = String(i + 1).padStart(3, " ");
          const name = (p.playerName || "").slice(0, 35).padEnd(35, " ");
          const pld = String(p.played || 0).padStart(4, " ");
          const w = String(p.won || 0).padStart(4, " ");
          const l = String(p.lost || 0).padStart(4, " ");
          const d = String(p.drawn || 0).padStart(4, " ");
          const pts = String(p.totalPoints || 0).padStart(4, " ");
          doc.text(`${rank} ${name} ${pld} ${w} ${l} ${d} ${pts}`);
        });
      });
    }

    // ── Knockout brackets ──
    for (const b of results.brackets) {
      if (!b.rounds.length) continue;
      doc.addPage();
      const who = b.kind === "team" ? "Team" : "Player";
      doc.font("Helvetica-Bold").fontSize(16).text(`${b.sportName} — ${b.kind === "team" ? "Team Knockout" : "Knockout"}`);
      doc.moveDown(0.5);
      for (const round of b.rounds) {
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(round.label);
        doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(10);
        round.matches.forEach((m) => {
          const score = m.score ? ` (${m.score})` : "";
          const winner = m.winner ? `  →  ${m.winner}${score}` : `  [${m.status || "pending"}]`;
          doc.text(`${m.p1}  vs  ${m.p2}${winner}`, { indent: 14 });
        });
        doc.moveDown(0.5);
      }
    }

    // Footer
    const groupCount = results.groups.length;
    const bracketCount = results.brackets.filter((b) => b.rounds.length).length;
    doc.font("Helvetica").fontSize(8).fillColor("#999")
      .text(
        `Chalo Khelne · ${groupCount} group${groupCount === 1 ? "" : "s"} · ${bracketCount} bracket${bracketCount === 1 ? "" : "s"}`,
        50, doc.page.height - 40, { align: "center", width: doc.page.width - 100 }
      );

    doc.end();
  } catch (err) {
    console.error("[EXPORT] results pdf:", err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    else res.end();
  }
};
