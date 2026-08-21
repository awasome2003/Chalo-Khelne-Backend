const express = require("express");
const multer = require("multer");
const csv = require("csvtojson");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { readSheetRows, writeAoaToFile } = require("../utils/excelUtils");

const User = require("../src/modules/identity/models/User");
const { miniAIMatch } = require("../utils/miniAIMapper");
const { requireSuperAdmin } = require("../middleware/authMiddleware");

const router = express.Router();
// 5MB cap prevents large-file DoS on the import endpoints.
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

// User provisioning is a SuperAdmin-only operation — guard the whole router.
router.use(requireSuperAdmin);

// ✅ GET: Download Excel Template
router.get("/template", async (req, res) => {
  try {
    const templatePath = path.join(__dirname, "../templates/user_template.xlsx");
    const templateDir = path.dirname(templatePath);

    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }

    // dateOfBirth is required — User.dateOfBirth is mandatory for the age-gated
    // roles (Player/Trainer/Referee) and every imported account is a Player.
    // `role` is deliberately absent: the importer always creates Players and
    // ignores any role column, so offering one in the template only misleads.
    const data = [
      ["name", "email", "mobile", "password", "dateOfBirth", "sex"],
      ["John Doe", "john@example.com", "9876543210", "password123", "1998-04-23", "male"],
      ["Jane Smith", "jane@example.com", "9123456780", "password123", "2001-11-02", "female"],
    ];

    await writeAoaToFile(data, templatePath, "Users");

    res.download(templatePath, "ChaloKhelne_User_Template.xlsx", (err) => {
      if (err) {
        console.error("Error downloading template:", err);
        if (!res.headersSent) res.status(500).send("Error downloading template");
      }
    });
  } catch (error) {
    console.error("Error generating template:", error);
    res.status(500).send("Error generating template");
  }
});

// ✅ POST: Bulk Upload
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const filePath = path.join(__dirname, "..", req.file.path);
    const originalName = req.file.originalname.toLowerCase();
    const mime = req.file.mimetype;

    let jsonArray = [];

    if (mime === "text/csv" || mime === "application/vnd.ms-excel" || originalName.endsWith(".csv")) {
      jsonArray = await csv().fromFile(filePath);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      originalName.endsWith(".xlsx") ||
      originalName.endsWith(".xls")
    ) {
      // No blankValue → sparse rows, matching the previous sheet_to_json default.
      jsonArray = await readSheetRows(filePath);
    } else if (mime === "application/pdf") {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        const lines = data.text.split("\n").filter((line) => line.trim() !== "");

        if (lines.length < 2) {
          fs.unlinkSync(filePath);
          return res.status(400).json({ success: false, message: "PDF does not contain valid tabular data" });
        }

        const headers = lines[0].split(/[,\t]/).map((h) => h.trim());
        jsonArray = lines.slice(1).map((line) => {
          const values = line.split(/[,\t]/).map((v) => v.trim());
          const obj = {};
          headers.forEach((h, i) => (obj[h] = values[i]));
          return obj;
        });
      } catch (err) {
        console.error("PDF Parsing Error:", err.message);
        fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, message: "Could not parse PDF" });
      }
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ path: filePath });
      const lines = result.value.split("\n").filter((line) => line.trim() !== "");
      if (lines.length > 0) {
        const headers = lines[0].split(/[,\t]/).map((h) => h.trim());
        jsonArray = lines.slice(1).map((line) => {
          const values = line.split(/[,\t]/).map((v) => v.trim());
          const obj = {};
          headers.forEach((h, i) => (obj[h] = values[i]));
          return obj;
        });
      }
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: "Unsupported file type" });
    }

    if (!jsonArray || jsonArray.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: "File is empty or invalid format" });
    }

    const report = await processUserUpload(jsonArray);
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      // `message` is kept for any caller that only reads the summary string.
      message:
        `Bulk upload complete. Created ${report.successCount}, ` +
        `skipped ${report.skippedCount} (already existed), failed ${report.errorCount}.`,
      created: report.successCount,
      skipped: report.skippedCount,
      failed: report.errorCount,
      totalRows: report.totalRows,
      // Per-row outcomes for everything that was NOT created, so the operator
      // can fix the sheet instead of guessing which rows were rejected.
      rows: report.rows,
      truncated: report.truncated,
    });
  } catch (error) {
    console.error("Upload Error:", error);
    if (req.file) {
      try { fs.unlinkSync(path.join(__dirname, "..", req.file.path)); } catch (_) {}
    }
    res.status(500).json({ success: false, message: "Server Error during upload" });
  }
});

// ✅ POST: Create Single User
router.post("/single", async (req, res) => {
  try {
    const b = req.body || {};

    if (!b.name || !b.email || !b.mobile || !b.password) {
      return res.status(400).json({ success: false, message: "Please fill all required fields" });
    }

    // Required for the Player role this endpoint always creates. Returned as a
    // 400 with a specific message — it used to fall through to User.create and
    // surface as an opaque 500.
    const dateOfBirth = parseDob(b.dateOfBirth);
    if (!dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: b.dateOfBirth
          ? "Date of birth is not a valid date — use YYYY-MM-DD or DD/MM/YYYY"
          : "Date of birth is required",
      });
    }

    const existingUser = await User.findOne({ email: String(b.email) });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User with this email already exists" });
    }

    // Allowlist input — never accept role/isApproved/permissions from the client.
    // Imported users are created as approved Players; elevate later via the
    // guarded role endpoint (/api/update/user-role).
    // `age` is intentionally not taken from the client: the User pre-save hook
    // derives it from dateOfBirth, along with isMinor and ageGroup.
    const userData = {
      name: b.name,
      email: b.email,
      mobile: b.mobile,
      password: b.password,
      dateOfBirth,
      sex: b.sex,
      role: "Player",
      isApproved: true,
      playerId: "PLR" + Date.now(),
    };

    await User.create(userData);
    res.json({ success: true, message: "User created successfully" });
  } catch (error) {
    console.error("Single User Creation Error:", error);
    res.status(500).json({ success: false, message: "Error creating user" });
  }
});

// Cap on the per-row detail returned to the client. A 5MB sheet can hold tens
// of thousands of rows; the counts stay exact, only the itemised list is
// truncated (the response says how many were omitted).
const MAX_REPORTED_ROWS = 100;

// dateOfBirth is required because every imported account is created as a
// Player, and User.dateOfBirth is mandatory for the age-gated roles. It also
// drives isMinor / ageGroup, which the Families Policy gating reads.
const REQUIRED_COLUMNS = ["name", "email", "mobile", "password", "dateOfBirth"];

/**
 * Coerce a spreadsheet cell to a Date. Accepts a real Date (xlsx cells often
 * parse as one), an ISO string, or DD/MM/YYYY — the format the rest of the
 * platform uses for dates typed by hand. Returns null when unusable, so the
 * row is reported rather than silently saved with a bad date.
 */
function parseDob(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  const s = String(raw).trim();
  if (!s) return null;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const iso = new Date(s);
  if (Number.isNaN(iso.getTime())) return null;
  // Guard against a future date of birth — almost always a swapped DD/MM.
  if (iso.getTime() > Date.now()) return null;
  return iso;
}

async function processUserUpload(jsonArray) {
  const userSchemaFields = Object.keys(User.schema.paths);
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const rows = [];

  // Row numbers are 1-based and count the header, so they line up with what
  // the operator sees in Excel.
  const addRow = (index, email, status, reason) => {
    if (rows.length < MAX_REPORTED_ROWS) {
      rows.push({ row: index + 2, email: email || null, status, reason });
    }
  };

  for (let i = 0; i < jsonArray.length; i++) {
    const entry = jsonArray[i];
    const entryKeys = Object.keys(entry);
    const fieldMap = miniAIMatch(entryKeys, userSchemaFields);

    const userObj = {};
    for (const key in entry) {
      if (fieldMap[key]) {
        userObj[fieldMap[key]] = entry[key];
      }
    }
    // Never provision role/approval/permissions from the imported file.
    delete userObj.role;
    delete userObj.isApproved;
    delete userObj.permissions;

    try {
      // Distinguish "the sheet has no such column" from "this row's cell is
      // blank". Both used to report as "Missing required value", which reads
      // like bad data when the real cause is a header the mapper did not
      // recognise — and with 200+ identical failures there was nothing in the
      // response to tell the operator which it was.
      const mappedTargets = new Set(Object.values(fieldMap));
      const absentColumns = REQUIRED_COLUMNS.filter((f) => !mappedTargets.has(f));
      const blankCells = REQUIRED_COLUMNS.filter(
        (f) => mappedTargets.has(f) && !userObj[f]
      );

      if (absentColumns.length > 0 || blankCells.length > 0) {
        errorCount++;
        const parts = [];
        if (absentColumns.length > 0) {
          parts.push(
            `No column found for: ${absentColumns.join(", ")}. ` +
              `Columns detected in your file: ${entryKeys.join(", ")}`
          );
        }
        if (blankCells.length > 0) {
          parts.push(`Empty value: ${blankCells.join(", ")}`);
        }
        addRow(i, userObj.email, "failed", parts.join(" | "));
        continue;
      }

      const dob = parseDob(userObj.dateOfBirth);
      if (!dob) {
        errorCount++;
        addRow(
          i,
          userObj.email,
          "failed",
          `Could not read the date of birth "${userObj.dateOfBirth}" — use YYYY-MM-DD or DD/MM/YYYY`
        );
        continue;
      }
      userObj.dateOfBirth = dob;

      const existing = await User.findOne({ email: String(userObj.email) });
      if (existing) {
        // A duplicate is not a malformed row — the operator re-uploaded a sheet
        // that overlaps existing users. Counted separately so a re-run of the
        // same file reads as "nothing to do", not "50 errors".
        skippedCount++;
        addRow(i, userObj.email, "skipped", "A user with this email already exists");
        continue;
      }

      userObj.playerId = "PLR" + Math.floor(Math.random() * 1000000) + Date.now();
      userObj.role = "Player";
      userObj.isApproved = true;
      await User.create(userObj);
      successCount++;
    } catch (err) {
      console.log("Save Error:", err.message);
      errorCount++;
      addRow(i, userObj.email, "failed", err.message || "Could not be saved");
    }
  }

  return {
    successCount,
    errorCount,
    skippedCount,
    rows,
    totalRows: jsonArray.length,
    truncated: Math.max(0, errorCount + skippedCount - rows.length),
  };
}

module.exports = router;
