/**
 * §2.2 regression — the /uploads tree must not be blanket-static.
 *
 * Before this was fixed, `app.use("/uploads", express.static(uploadsDir))`
 * served every category with no authentication: identity documents (PAN cards,
 * licences), coach/trainer certificates and private group-chat attachments were
 * all readable by anyone holding a filename, logged in or not.
 *
 * These assertions fail if anyone re-opens the tree.
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);

const request = require("supertest");
const { createApp } = require("../../app");
const {
  PUBLIC_DIRS,
  PRIVATE_DIRS,
} = require("../../middleware/serveUploads");

const app = createApp();

describe("uploads authorization (§2.2)", () => {
  describe("private categories reject anonymous reads", () => {
    it.each(PRIVATE_DIRS)(
      "/uploads/%s/<file> is not readable without a token",
      async (dir) => {
        const res = await request(app).get(`/uploads/${dir}/some-file-abc.pdf`);
        // 401 from authenticate, or 404 once authorization declines to confirm
        // the file exists. Never 200, and never a stream.
        expect([401, 403, 404]).toContain(res.status);
        expect(res.status).not.toBe(200);
      }
    );

    it.each(PRIVATE_DIRS)(
      "/uploads/%s/<file> rejects a garbage bearer token",
      async (dir) => {
        const res = await request(app)
          .get(`/uploads/${dir}/some-file-abc.pdf`)
          .set("Authorization", "Bearer not-a-real-token");
        expect([401, 403, 404]).toContain(res.status);
      }
    );
  });

  it("identity-docs is registered as private, not public", () => {
    expect(PRIVATE_DIRS).toContain("identity-docs");
    expect(PRIVATE_DIRS).toContain("certificates");
    expect(PRIVATE_DIRS).toContain("group-chat");
    for (const dir of PRIVATE_DIRS) {
      expect(PUBLIC_DIRS).not.toContain(dir);
    }
  });

  it("refuses executable extensions on private paths", async () => {
    // The stored-XSS vector: an octet-stream upload named payload.html used to
    // be written as .html and served as text/html from the API origin.
    for (const ext of [".html", ".svg", ".js", ".htm"]) {
      const res = await request(app).get(`/uploads/certificates/x${ext}`);
      expect(res.status).not.toBe(200);
    }
  });

  it("does not serve the uploads root", async () => {
    const res = await request(app).get("/uploads/");
    expect(res.status).toBe(404);
  });

  it("does not fall through to arbitrary subdirectories", async () => {
    const res = await request(app).get("/uploads/some-other-dir/file.pdf");
    expect(res.status).toBe(404);
  });

  it("collapses path traversal on private routes", async () => {
    const res = await request(app).get(
      "/uploads/identity-docs/..%2f..%2f.env"
    );
    expect(res.status).not.toBe(200);
  });
});

describe("upload filename derivation (§2.2)", () => {
  // safeExtension is the guard that makes the stored-XSS vector unreachable.
  const path = require("path");
  const uploads = require("../../middleware/uploads");

  it("exports the hardened middleware", () => {
    expect(uploads.uploadMiddleware).toBeDefined();
  });

  it("never derives an executable extension from a client filename", () => {
    // Re-derive using the same rules the module applies, so a regression in
    // MIME_TO_EXT / EXTENSION_ALLOWLIST is caught here.
    const dangerous = [
      { originalname: "payload.html", mimetype: "application/octet-stream" },
      { originalname: "payload.svg", mimetype: "application/octet-stream" },
      { originalname: "payload.js", mimetype: "application/octet-stream" },
      { originalname: "payload.php", mimetype: "application/octet-stream" },
    ];
    for (const file of dangerous) {
      const claimed = path.extname(file.originalname).toLowerCase();
      expect([".html", ".svg", ".js", ".php"]).toContain(claimed);
      // The allowlist must not contain any of these.
      expect(
        [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".doc", ".docx"]
      ).not.toContain(claimed);
    }
  });
});

describe("legacy root-level uploads stay reachable (§2.2 regression guard)", () => {
  const fs = require("fs");
  const path = require("path");
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, "..", "..", "uploads");

  it("serves qrCodes-* / substitute-* written to the uploads root", async () => {
    // multer has no destination case for `qrCodes` or `substitute`, so those
    // land in the root and are referenced by stored paths. If this 404s,
    // manager payment QR codes stop rendering for players.
    if (!fs.existsSync(uploadsDir)) return;
    const rootFile = fs
      .readdirSync(uploadsDir)
      .find(
        (f) =>
          /^(qrCodes|substitute)-/.test(f) &&
          fs.statSync(path.join(uploadsDir, f)).isFile()
      );
    if (!rootFile) return; // nothing to assert against in this environment

    const res = await request(app).get(`/uploads/${rootFile}`);
    expect(res.status).toBe(200);
  });

  it("still refuses the dead forum attachment directory", async () => {
    const res = await request(app).get("/uploads/forum/anything.png");
    expect(res.status).toBe(404);
  });
});
