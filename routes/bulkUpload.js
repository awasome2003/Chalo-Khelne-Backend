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

    const data = [
      ["name", "email", "mobile", "password", "role", "age", "sex"],
      ["John Doe", "john@example.com", "9876543210", "password123", "Player", "25", "male"],
      ["Jane Smith", "jane@example.com", "9123456780", "password123", "Manager", "30", "female"],
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

    const { successCount, errorCount } = await processUserUpload(jsonArray);
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `Bulk upload complete. Successfully created ${successCount} users. Errors: ${errorCount}`,
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

    const existingUser = await User.findOne({ email: String(b.email) });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User with this email already exists" });
    }

    // Allowlist input — never accept role/isApproved/permissions from the client.
    // Imported users are created as approved Players; elevate later via the
    // guarded role endpoint (/api/update/user-role).
    const userData = {
      name: b.name,
      email: b.email,
      mobile: b.mobile,
      password: b.password,
      age: b.age,
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

async function processUserUpload(jsonArray) {
  const userSchemaFields = Object.keys(User.schema.paths);
  let successCount = 0;
  let errorCount = 0;

  for (const entry of jsonArray) {
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
      // Basic validation
      if (userObj.name && userObj.email && userObj.mobile && userObj.password) {
        // Check if user already exists
        const existing = await User.findOne({ email: String(userObj.email) });
        if (!existing) {
          userObj.playerId = "PLR" + Math.floor(Math.random() * 1000000) + Date.now();
          userObj.role = "Player";
          userObj.isApproved = true;
          await User.create(userObj);
          successCount++;
        } else {
          errorCount++;
        }
      } else {
        errorCount++;
      }
    } catch (err) {
      console.log("Save Error:", err.message);
      errorCount++;
    }
  }

  return { successCount, errorCount };
}

module.exports = router;
