const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

// Import routes
const authRoutes = require("./routes/authRoutes");
const protectedRoutes = require("./routes/protectedRoutes");
const updateRoutes = require("./routes/updateRoutes");
const managerRoute = require("./routes/managerRoute");
const eventRoutes = require("./routes/eventRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");
const playerRoutes = require("./routes/playerRoutes");
const emailverification = require("./routes/emailverification");
const turfRoutes = require("./routes/turfRoutes");
const trainerRoutes = require("./routes/trainerRoutes");
const refereeRoutes = require("./routes/refereeRoutes");
const passwordReset = require("./routes/passwordReset");
const postRoutes = require("./routes/postRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const favoriteRoutes = require("./routes/favoriteRoutes");
const ClubAdminProfile = require("./routes/clubAdminProfileRoutes")
const Search = require("./routes/search")
const BulkUpload = require("./routes/bulkUpload")
const sportRoutes = require("./routes/sportRoutes");
const sportRuleBookRoutes = require("./routes/sportRuleBookRoutes");
const ManagerPayment = require("./routes/managerPaymentRoutes")
const corporateRoutes = require("./routes/corporateRoutes");
const inquiryRoutes = require("./routes/inquiryRoutes");
const newsRoutes = require("./routes/newsRoutes");
const donationRoutes = require("./routes/donationRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const chatRoutes = require("./routes/chatRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const clubAdminFinanceRoutes = require("./routes/clubAdminFinanceRoutes");
const rbacRoutes = require("./routes/rbacRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const invitationRoutes = require("./routes/invitationRoutes");
const couponRoutes = require("./routes/couponRoutes");
const { Server } = require("socket.io");
const setupSocket = require("./socket/socketHandler");

// Initialize express
const app = express();

// SSL Configuration - only for production or when explicitly enabled
let sslOptions = null;
const useSSL = process.env.USE_SSL === 'true' && process.env.NODE_ENV === 'production';

if (useSSL) {
  const certPath = process.env.SSL_CERT_PATH || "/etc/letsencrypt/live/dev.bestowalsystems.in/fullchain.pem";
  const keyPath = process.env.SSL_KEY_PATH || "/etc/letsencrypt/live/dev.bestowalsystems.in/privkey.pem";

  // Check if SSL certificates exist
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      secureProtocol: "TLS_method",
      ciphers: [
        "ECDHE-RSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES128-SHA256",
        "ECDHE-RSA-AES256-SHA384",
      ].join(":"),
      honorCipherOrder: true,
    };
    console.log("SSL certificates loaded successfully");
  } else {
    console.warn("SSL certificates not found at specified paths. Starting HTTP server instead.");
    console.warn(`Cert path: ${certPath}`);
    console.warn(`Key path: ${keyPath}`);
  }
}

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
const profilesDir = path.join(uploadsDir, "profiles");
const certificatesDir = path.join(uploadsDir, "certificates");

[uploadsDir, profilesDir, certificatesDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(express.json());
app.use(cors({ origin: "*" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.locals.directories = {
  uploads: uploadsDir,
  profiles: profilesDir,
  certificates: certificatesDir,
};

require("./Modal/ClubManager");
require("./Modal/Referee");

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.send("Chalo Khelne API is running");
});

// Routes
app.use("/api", authRoutes);
app.use("/api/protected", protectedRoutes);
app.use("/api/update", updateRoutes);
app.use("/api/manager", managerRoute);
app.use("/api/events", eventRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/email", emailverification);
app.use("/api/turfs", turfRoutes);
app.use("/api/trainer", trainerRoutes);
app.use("/api/referee", refereeRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", favoriteRoutes);
app.use("/api", passwordReset);
app.use("/api/clubadminprofile", ClubAdminProfile)
app.use("/api/search", Search)
app.use("/api/bulk-upload", BulkUpload)
app.use("/api/sports", sportRoutes);
app.use("/api/sport-rules", sportRuleBookRoutes);
app.use("/api/payments", ManagerPayment);// Error handling middleware
app.use("/api/corporate", corporateRoutes);
app.use("/api/inquiries", inquiryRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/club-admin/finance", clubAdminFinanceRoutes);
app.use("/api/roles", rbacRoutes);
app.use("/api/equipment", vendorRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/forum", require("./routes/forumRoutes"));
app.use("/api/forum-chat", require("./routes/forumChatRoutes"));
app.use("/api/group-chat", require("./routes/groupChatRoutes"));
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Handle multer errors
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "File too large. Maximum size is 5MB.",
      });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: "Something broke!" });
});

const PORT = process.env.PORT || 3003;

// Start server with or without SSL
let server;
if (sslOptions) {
  server = https.createServer(sslOptions, app);
  server.listen(PORT, () => {
    console.log(`HTTPS Server running on https://dev.bestowalsystems.in:${PORT}`);
  });
} else {
  server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`HTTP Server running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production') {
      console.warn("WARNING: Running HTTP server in production mode!");
    }
  });
}

// Socket.io — attach to existing HTTP server
const io = new Server(server, {
  cors: { origin: "*" },
});
app.set("io", io);
setupSocket(io);
console.log("[SOCKET] Socket.io initialized");