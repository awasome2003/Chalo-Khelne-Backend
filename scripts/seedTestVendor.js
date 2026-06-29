/**
 * Seed ONE ready-to-use test vendor (for local testing).
 *
 * Unlike the SuperAdmin "Create Vendor" form (which emails a set-password link),
 * this creates a vendor with a KNOWN password so you can log in immediately and
 * test the Vendor web app (dashboard / store profile).
 *
 * Re-runnable: it deletes any existing vendor with the same email first.
 *
 *   node scripts/seedTestVendor.js
 *
 * Then log in on the web at /login with the printed email + password.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/modules/identity/models/User");
const VendorProfile = require("../src/modules/commerce/models/VendorProfile");

const EMAIL = "testvendor@chalokhelne.com";
const PASSWORD = "Vendor@12345";

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set. See .env.example.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  // Clean any previous run.
  const existing = await User.findOne({ email: EMAIL });
  if (existing) {
    await VendorProfile.deleteMany({ userId: existing._id });
    await User.deleteOne({ _id: existing._id });
    console.log("Removed previous test vendor.");
  }
  await VendorProfile.deleteMany({ email: EMAIL });

  // User (role vendor) — pre-save hook hashes the password.
  const user = new User({
    name: "Rohit Sharma",
    email: EMAIL,
    mobile: "9876543210",
    dateOfBirth: new Date("1970-01-01"), // placeholder (User model requires it; vendors have no DOB)
    password: PASSWORD,
    role: "vendor",
    status: "active",
    isApproved: true,
    emailVerified: true,
  });
  await user.save();

  const profile = await VendorProfile.create({
    userId: user._id,
    businessName: "SportsPro Store",
    businessType: "Sports Equipment Store",
    ownerName: "Rohit Sharma",
    phone: "9876543210",
    email: EMAIL,
    address: { line: "12 MG Road", city: "Pune", state: "Maharashtra", country: "India", postalCode: "411001" },
    location: { mapUrl: "", lat: "18.5204", lng: "73.8567" },
    gstNumber: "27ABCDE1234F1Z5",
    panNumber: "ABCDE1234F",
    businessRegNumber: "REG-2024-0099",
    licenseNumber: "",
    sportsCategories: ["Cricket", "Badminton", "Football"],
    productCategories: ["Equipment", "Apparel", "Shoes"],
    businessModel: "Retail + Wholesale",
    deliveryOptions: ["Store Pickup", "Local Delivery", "Nationwide Delivery"],
    paymentSettlement: "Monthly",
    commissionPercent: 10,
    username: "sportspro",
    credentialDelivery: "email",
    permissions: {
      addProducts: true, editProducts: true, deleteProducts: true,
      viewOrders: true, manageOrders: true, cancelOrders: false,
      viewCustomers: true, contactCustomers: true,
      viewEarnings: true, downloadInvoices: true,
      createOffers: true, createCoupons: false,
    },
    description: "Premium multi-sport equipment & apparel store serving players across Pune.",
    storeHighlights: "Authorized dealer · Same-day local delivery · Easy returns",
    workingHours: "Mon–Sat 10:00 AM – 8:00 PM",
    inventory: { productCategories: ["Equipment", "Apparel"], skuPrefix: "SP-", stockAlerts: true },
    status: "active",
    documentsVerified: true,
    isPlatformVendor: true, // receives all player product uploads for review
    createdBy: null,
  });

  console.log("\n✅ Test vendor ready:");
  console.log("   business:", profile.businessName);
  console.log("   login email:", EMAIL);
  console.log("   password:", PASSWORD);
  console.log("\nLog in on the web at /login → you'll land on the Vendor dashboard.\n");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Seed failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
