const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create directories with proper paths
const uploadsDir = path.join(__dirname, "..", "uploads");
const profilesDir = path.join(uploadsDir, "profiles");
const certificatesDir = path.join(uploadsDir, "certificates");
const identityDocsDir = path.join(uploadsDir, "identity-docs");
const tournamentsDir = path.join(uploadsDir, "tournaments");
const eventsDir = path.join(uploadsDir, "events");
const turfsDir = path.join(uploadsDir, "turfs");
// Create upload path
const uploadPath = path.join(process.cwd(), "uploads/qrcodes");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// Ensure directories exist
[
  uploadsDir,
  profilesDir,
  certificatesDir,
  identityDocsDir,
  tournamentsDir,
  eventsDir,
  turfsDir,
].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
});

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const ALLOWED_CERTIFICATE_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "image/jpg",
];

const ALLOWED_IDENTITY_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "image/jpg",
];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Check fieldname to determine destination
    if (file.fieldname === "tournamentLogo") {
      cb(null, tournamentsDir);
    } else if (file.fieldname === "profile-image") {
      cb(null, profilesDir);
    } else if (file.fieldname === "certificate") {
      cb(null, certificatesDir);
    } else if (file.fieldname === "identity-document") {
      cb(null, identityDocsDir);
    } else if (file.fieldname === "playerImages") {
      // Handle player images for events
      cb(null, eventsDir);
    } else if (file.fieldname === "turfImages") {
      // Handle turf images
      cb(null, turfsDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.fieldname === "tournamentLogo" ||
    file.fieldname === "playerImages" ||
    file.fieldname === "turfImages" ||
    file.fieldname === "qrCodes"
  ) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid file type for images"), false);
    }
    cb(null, true);
  } else if (file.fieldname === "profile-image") {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid image type"), false);
    }
    cb(null, true);
  } else if (file.fieldname === "certificate") {
    if (!ALLOWED_CERTIFICATE_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid certificate type"), false);
    }
    cb(null, true);
  } else if (file.fieldname === "identity-document") {
    if (!ALLOWED_IDENTITY_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid identity document type"), false);
    }
    cb(null, true);
  } else {
    cb(new Error("Invalid field name"), false);
  }
};
// Create multer instance
const uploadMiddleware = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

module.exports = {
  uploadMiddleware,
  uploadsDir,
  tournamentsDir,
  profilesDir,
  certificatesDir,
  identityDocsDir,
  eventsDir,
  turfsDir,
  cleanupFile: async (filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error("Error cleaning up file:", error);
    }
  },
};
