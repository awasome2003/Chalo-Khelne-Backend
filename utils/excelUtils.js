// ═══════════════════════════════════════════════════════════════
// EXCEL I/O (exceljs)
// ───────────────────────────────────────────────────────────────
// Single owner of all .xlsx read/write in the server. Replaces the
// `xlsx` (SheetJS) package, which had two HIGH advisories (Prototype
// Pollution + ReDoS) with no fix published on npm.
//
// Behaviour notes vs. the old xlsx.utils.sheet_to_json:
//  • readSheetRows mirrors sheet_to_json — row 1 is the header, each
//    later row becomes an object keyed by those headers.
//  • Pass { blankValue: "" } to mirror sheet_to_json's { defval: "" }
//    (empty cells materialise as ""). Omit it to get sparse rows
//    (empty cells dropped), which is sheet_to_json's default.
//  • exceljs (unlike SheetJS) does NOT read the legacy binary .xls
//    (BIFF) format — only .xlsx/.csv. A genuine old .xls upload will
//    throw a parse error; callers surface it as a 400. Modern .xlsx
//    files (Office 2007+) are unaffected.
// ═══════════════════════════════════════════════════════════════
const ExcelJS = require("exceljs");

/**
 * Reduce an exceljs cell value to a plain primitive comparable to what
 * SheetJS's sheet_to_json produced. exceljs returns rich objects for
 * formulas / hyperlinks / rich text; flatten those to their text/result.
 */
function cellToValue(v) {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellToValue(v.result); // formula → computed result
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join(""); // rich text runs
    if ("text" in v) return v.text; // hyperlink / shared-string object
    if ("error" in v) return undefined; // #REF! etc.
    return undefined;
  }
  return v;
}

/**
 * Read the first worksheet of an .xlsx file into an array of row objects
 * keyed by the header row (row 1).
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {string} [opts.blankValue] If present, empty cells become this
 *   value (mirrors sheet_to_json {defval}). If absent, empty cells are
 *   skipped (sparse rows — sheet_to_json default).
 * @returns {Promise<object[]>}
 */
async function readSheetRows(filePath, opts = {}) {
  const hasBlank = Object.prototype.hasOwnProperty.call(opts, "blankValue");
  const blankValue = opts.blankValue;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  // Header map: 1-based column number → trimmed header string.
  const headerRow = worksheet.getRow(1);
  const headers = {};
  const colCount = worksheet.columnCount || 0;
  for (let c = 1; c <= colCount; c++) {
    const h = cellToValue(headerRow.getCell(c).value);
    if (h !== undefined && String(h).trim() !== "") headers[c] = String(h).trim();
  }

  const rows = [];
  const rowCount = worksheet.rowCount || 0;
  for (let r = 2; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    let hasAny = false;
    for (const c of Object.keys(headers)) {
      const key = headers[c];
      const raw = cellToValue(row.getCell(Number(c)).value);
      if (raw === undefined || raw === "") {
        if (hasBlank) obj[key] = blankValue;
      } else {
        obj[key] = raw;
        hasAny = true;
      }
    }
    if (hasAny) rows.push(obj); // skip fully-empty rows, like sheet_to_json
  }
  return rows;
}

/**
 * Write an array-of-arrays (first row = headers) to an .xlsx file.
 * Replaces XLSX.utils.aoa_to_sheet + book_new + book_append_sheet + writeFile.
 *
 * @param {Array<Array<any>>} aoa
 * @param {string} filePath
 * @param {string} [sheetName="Sheet1"]
 * @returns {Promise<void>}
 */
async function writeAoaToFile(aoa, filePath, sheetName = "Sheet1") {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRows(aoa || []);
  await workbook.xlsx.writeFile(filePath);
}

module.exports = { readSheetRows, writeAoaToFile, cellToValue };
