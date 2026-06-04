/**
 * Seed sample products (EquipmentListing) under one or more PLAYER ids so you
 * can test the vendor → store flow. Each product starts at vendorStatus
 * "pending_review", so it lands in the platform vendor's Incoming queue.
 *
 * Usage (pass the player User ids as arguments):
 *   node scripts/seedTestProducts.js <playerId1> <playerId2> ...
 *   node scripts/seedTestProducts.js 6969de0e2... 696a1a4c8... --per 3
 *
 *   --per N   products to create per player (default 3)
 *
 * Re-runnable: it first removes that seller's existing "pending_review" seed
 * products so you don't pile up duplicates.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../Modal/User");
const EquipmentListing = require("../Modal/EquipmentListing");

// Default player (seller) ids — used when none are passed as arguments.
const DEFAULT_PLAYER_IDS = [
  "6943a037944d899a354224a5", // Omkar
  "69bd0e6ebfaa7aa856ea8a5f", // Rohan
];

// Sample sports products (cycled across players). Category/condition match the
// EquipmentListing enums.
const SAMPLES = [
  { sport: "Badminton", itemName: "Yonex Astrox 88D Pro Racket", category: "Racket", condition: "Good", originalPrice: 18000, askingPrice: 9000, brand: "Yonex", size: "4U", description: "Lightly used head-heavy racket, great for doubles. Grip recently replaced." },
  { sport: "Cricket", itemName: "SS Master 5000 English Willow Bat", category: "Bat", condition: "Like New", originalPrice: 8000, askingPrice: 5000, brand: "SS", size: "SH", description: "Knocked-in, used in 3 matches. Excellent ping." },
  { sport: "Football", itemName: "Nike Strike Football (Size 5)", category: "Ball", condition: "Fair", originalPrice: 2500, askingPrice: 1200, brand: "Nike", size: "5", description: "Match ball, holds air well, minor scuffs." },
  { sport: "Tennis", itemName: "Wilson Pro Staff 97 Racket", category: "Racket", condition: "Used", originalPrice: 15000, askingPrice: 6000, brand: "Wilson", size: "L3", description: "Strings need replacing; frame solid." },
  { sport: "Badminton", itemName: "Li-Ning Ranger Court Shoes", category: "Shoes", condition: "Good", originalPrice: 5000, askingPrice: 2500, brand: "Li-Ning", size: "UK 9", description: "Non-marking sole, good grip, used one season." },
  { sport: "Basketball", itemName: "Spalding NBA Indoor Ball", category: "Ball", condition: "Good", originalPrice: 3500, askingPrice: 1800, brand: "Spalding", size: "7", description: "Indoor composite leather, great bounce." },
];

function parseArgs() {
  const argv = process.argv.slice(2);
  let per = 3;
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--per") { per = parseInt(argv[++i], 10) || 3; continue; }
    ids.push(argv[i]);
  }
  return { ids, per };
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set. See .env.example.");
    process.exit(1);
  }
  const { ids: argIds, per } = parseArgs();
  const ids = argIds.length ? argIds : DEFAULT_PLAYER_IDS;
  if (!argIds.length) console.log(`No ids passed — using ${DEFAULT_PLAYER_IDS.length} default player id(s).`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  let created = 0;
  for (const rawId of ids) {
    if (!mongoose.isValidObjectId(rawId)) {
      console.warn(`  ⚠ skip "${rawId}" — not a valid id`);
      continue;
    }
    const user = await User.findById(rawId).select("name").lean();
    const sellerName = user?.name || "Player";
    if (!user) console.warn(`  ⚠ no User found for ${rawId} — seeding with name "Player"`);

    // Clean previous pending-review seed for this seller (idempotent re-run).
    const del = await EquipmentListing.deleteMany({ seller: rawId, vendorStatus: "pending_review" });
    if (del.deletedCount) console.log(`  cleared ${del.deletedCount} old pending product(s) for ${sellerName}`);

    for (let i = 0; i < per; i++) {
      const s = SAMPLES[(created + i) % SAMPLES.length];
      await EquipmentListing.create({
        seller: rawId,
        sellerName,
        sellerLevel: "club",
        sport: s.sport,
        itemName: s.itemName,
        description: s.description,
        category: s.category,
        condition: s.condition,
        brand: s.brand,
        size: s.size,
        quantity: 1,
        originalPrice: s.originalPrice,
        askingPrice: s.askingPrice,
        isDonation: false,
        images: [],
        vendorStatus: "pending_review",
        status: "Active",
      });
    }
    created += per;
    console.log(`  ✅ ${per} product(s) seeded under ${sellerName} (${rawId})`);
  }

  console.log(`\nDone — ${created} products created (vendorStatus: pending_review).`);
  console.log("They now appear in the platform vendor's Incoming Products queue.\n");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Seed failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
