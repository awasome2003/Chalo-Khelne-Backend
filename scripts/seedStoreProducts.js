/**
 * Seed STORE-VISIBLE products into the EquipmentListing collection.
 *
 * The public store feed (GET /api/donations/listings) filters on
 *   { vendorStatus: "listed" }
 * ONLY. The general seedDonations.js script leaves items at the default
 * vendorStatus "pending_review", so they never reach the store. This script
 * produces items in the exact shape the vendor "publishProduct" action creates
 * (see controllers/vendorStoreController.js): vendorStatus "listed", a resale
 * price mirrored into askingPrice, status Active, lifecycleStatus approved, and
 * a real listedAt timestamp — so they show up in the mobile store immediately.
 *
 * It generates ~56 products from a base catalogue (2 condition variants each)
 * so the paginated store has enough data to scroll through.
 *
 * Usage:
 *   node scripts/seedStoreProducts.js
 *   node scripts/seedStoreProducts.js --seller <userId>   # force a single seller
 *
 * Re-runnable: it removes any previously-seeded items (matched by itemName)
 * before inserting, so repeated runs don't pile up duplicates.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const EquipmentListing = require("../src/modules/commerce/models/EquipmentListing");
const User = require("../src/modules/identity/models/User");
const VendorProfile = require("../src/modules/commerce/models/VendorProfile");

// Base catalogue. Each entry is expanded into 2 listings (two condition tiers),
// giving ~56 store products across sports/categories.
// originalPrice = retail; askingPrice/vendorSalePrice are derived per condition.
const CATALOG = [
  // Badminton
  { sport: "Badminton", category: "Racket", brand: "Yonex", name: "Yonex Astrox 99 Pro", originalPrice: 12500, size: "4U" },
  { sport: "Badminton", category: "Racket", brand: "Li-Ning", name: "Li-Ning Windstorm 72", originalPrice: 8900, size: "5U" },
  { sport: "Badminton", category: "Racket", brand: "Victor", name: "Victor Thruster K Falcon", originalPrice: 9500, size: "4U" },
  { sport: "Badminton", category: "Shoes", brand: "Yonex", name: "Yonex Power Cushion 65Z", originalPrice: 7500, size: "UK 9" },
  { sport: "Badminton", category: "Shoes", brand: "Li-Ning", name: "Li-Ning Ranger Court Shoes", originalPrice: 5000, size: "UK 8" },
  // Cricket
  { sport: "Cricket", category: "Bat", brand: "SG", name: "SG Test Opening Bat", originalPrice: 15000, size: "SH" },
  { sport: "Cricket", category: "Bat", brand: "SS", name: "SS Master 5000 English Willow", originalPrice: 8000, size: "SH" },
  { sport: "Cricket", category: "Protective Gear", brand: "Kookaburra", name: "Kookaburra Ghost Keeping Gloves", originalPrice: 6000, size: "Adult" },
  { sport: "Cricket", category: "Protective Gear", brand: "SS", name: "SS Gladiator Batting Pads", originalPrice: 3500, size: "Adult" },
  { sport: "Cricket", category: "Protective Gear", brand: "MRF", name: "MRF Genius Cricket Helmet", originalPrice: 4500, size: "M" },
  // Tennis
  { sport: "Tennis", category: "Racket", brand: "Wilson", name: "Wilson Pro Staff RF97 Autograph", originalPrice: 22000, size: "L3" },
  { sport: "Tennis", category: "Racket", brand: "Babolat", name: "Babolat Pure Aero", originalPrice: 16000, size: "L2" },
  { sport: "Tennis", category: "Racket", brand: "Head", name: "Head Speed MP", originalPrice: 14000, size: "L3" },
  // Table Tennis
  { sport: "Table Tennis", category: "Bat", brand: "Butterfly", name: "Butterfly Timo Boll ALC Blade", originalPrice: 18000, size: "FL" },
  { sport: "Table Tennis", category: "Bat", brand: "Stiga", name: "Stiga Pro Carbon Paddle", originalPrice: 4000, size: "FL" },
  // Football
  { sport: "Football", category: "Shoes", brand: "Nike", name: "Nike Mercurial Superfly 8 Elite", originalPrice: 16000, size: "UK 10" },
  { sport: "Football", category: "Shoes", brand: "Adidas", name: "Adidas Predator Edge", originalPrice: 14000, size: "UK 9" },
  { sport: "Football", category: "Ball", brand: "Nike", name: "Nike Strike Football", originalPrice: 2500, size: "5" },
  { sport: "Football", category: "Jersey", brand: "Puma", name: "Puma Team Jersey Set", originalPrice: 6000, size: "L" },
  // Basketball
  { sport: "Basketball", category: "Ball", brand: "Spalding", name: "Spalding NBA Official Game Ball", originalPrice: 8000, size: "7" },
  { sport: "Basketball", category: "Ball", brand: "Nike", name: "Nike Elite Championship Ball", originalPrice: 5000, size: "7" },
  // Volleyball
  { sport: "Volleyball", category: "Ball", brand: "Mikasa", name: "Mikasa V200W Match Ball", originalPrice: 5500, size: "5" },
  { sport: "Volleyball", category: "Net", brand: "Molten", name: "Molten Pro Volleyball Net", originalPrice: 3000, size: "Standard" },
  // Pickleball
  { sport: "Pickleball", category: "Racket", brand: "Joola", name: "Joola Ben Johns Hyperion CFS 16mm", originalPrice: 14000, size: "Standard" },
  { sport: "Pickleball", category: "Racket", brand: "Selkirk", name: "Selkirk Amped Epic", originalPrice: 12000, size: "Standard" },
  // Hockey
  { sport: "Hockey", category: "Accessories", brand: "Grays", name: "Grays GR11000 Probow", originalPrice: 20000, size: "36.5\"" },
  { sport: "Hockey", category: "Shoes", brand: "Adidas", name: "Adidas Hockey Lux Turf Shoes", originalPrice: 9000, size: "UK 9" },
  // Chess / Carrom (Other / Accessories)
  { sport: "Chess", category: "Other", brand: "DGT", name: "DGT Electronic Chess Board", originalPrice: 35000, size: "Tournament" },
  { sport: "Carrom", category: "Other", brand: "Surco", name: "Surco Tournament Carrom Board", originalPrice: 8000, size: "33\"" },
];

// Curated Unsplash CDN images. Every URL below was downloaded and VISUALLY
// VERIFIED to show the relevant gear (not just a guess by keyword). assetUrl()
// on the client passes absolute http(s) URLs straight through, so they render
// as-is — no app change needed.
const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=600&q=80&auto=format&fit=crop`;
const SHOES         = ["1542291026-7eec264c27ff", "1606107557195-0e29a4b5b4aa", "1595950653106-6c9ebd614d3a", "1460353581641-37baddab0fa2"].map(IMG); // running/court shoes
const FOOTBALL_BOOT = ["1511886929837-354d827aae26", "1574629810360-7efbbe195018"].map(IMG);            // boot + ball on turf
const FOOTBALL_BALL = ["1599058917765-a780eda07a3e", "1518604666860-9ed391f76460", "1614632537190-23e4146777db"].map(IMG); // footballs
const FOOTBALL_KIT  = ["1517466787929-bc90951d0974"].map(IMG);                                          // player in jersey
const BADMINTON     = ["1599474924187-334a4ae5bd3c", "1626224583764-f87db24ac4ea"].map(IMG);           // racket / smash
const CRICKET       = ["1593766827228-8737b4534aa6", "1607734834519-d8576ae60ea6"].map(IMG);           // bat+ball+gloves / ground
const TENNIS        = ["1551958219-acbc608c6377", "1531315396756-905d68d21b56"].map(IMG);              // racket+balls / court
const TABLE_TENNIS  = ["1611251135345-18c56206b863"].map(IMG);                                          // paddles + ball
const BASKETBALL    = ["1546519638-68e109498ffc", "1521412644187-c49fa049e84d", "1519861531473-9200262188bf"].map(IMG); // ball / hoop
const VOLLEYBALL    = ["1592656094267-764a45160876", "1612872087720-bb876e2e67d1"].map(IMG);           // volleyball / beach net
const CHESS         = ["1529699211952-734e80c4d42b", "1528819622765-d6bcf132f793"].map(IMG);           // chess board (also proxy for carrom board)
const FIELD         = ["1607627000458-210e8d2bdb1d"].map(IMG);                                          // generic field (hockey fallback)

const SPORT_IMAGES = {
  Badminton: BADMINTON, Cricket: CRICKET, Tennis: TENNIS,
  "Table Tennis": TABLE_TENNIS, Basketball: BASKETBALL, Volleyball: VOLLEYBALL,
  Pickleball: TABLE_TENNIS, Chess: CHESS, Carrom: CHESS, Hockey: FIELD,
};

// Resolve a product image that actually shows the item: category wins for
// shoes / footballs / jerseys; otherwise a sport-specific gear photo. seq
// rotates through the pool so condition variants don't repeat the same photo.
function imageFor(sport, category, seq) {
  let pool;
  if (category === "Shoes") pool = sport === "Football" ? FOOTBALL_BOOT : SHOES;
  else if (category === "Ball" && sport === "Football") pool = FOOTBALL_BALL;
  else if (category === "Jersey") pool = FOOTBALL_KIT;
  else pool = SPORT_IMAGES[sport] || FIELD;
  return pool[seq % pool.length];
}

// Condition tiers → (price factor of original, resale markup factor).
const COND_TIERS = [
  { condition: "Like New", priceFactor: 0.62 },
  { condition: "Good", priceFactor: 0.48 },
  { condition: "Fair", priceFactor: 0.36 },
  { condition: "Used", priceFactor: 0.28 },
];
const SELLER_LEVELS = ["district", "state", "national", "club"];

const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);

// Build the full product list: 2 condition variants per catalogue item.
function buildProducts() {
  const out = [];
  CATALOG.forEach((base, i) => {
    // Pick two distinct condition tiers, rotated for variety.
    const tierA = COND_TIERS[i % COND_TIERS.length];
    const tierB = COND_TIERS[(i + 1) % COND_TIERS.length];
    [tierA, tierB].forEach((tier) => {
      const asking = round10(base.originalPrice * tier.priceFactor);
      const resale = round10(asking * 1.2); // vendor margin shown in store
      out.push({
        ...base,
        itemName: `${base.name} (${tier.condition})`,
        condition: tier.condition,
        sellerLevel: SELLER_LEVELS[out.length % SELLER_LEVELS.length],
        originalPrice: base.originalPrice,
        askingPrice: resale,
        vendorSalePrice: resale,
        images: [imageFor(base.sport, base.category, out.length)],
        description: `${tier.condition} ${base.name} for ${base.sport}. Vendor-inspected, cleaned and ready to play. Genuine ${base.brand} product.`,
      });
    });
  });
  return out;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let forcedSeller = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seller") forcedSeller = argv[++i];
  }
  return { forcedSeller };
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set in .env");
    process.exit(1);
  }
  const { forcedSeller } = parseArgs();

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  // Resolve sellers — either a forced id, or the first several real users.
  let sellers;
  if (forcedSeller) {
    if (!mongoose.isValidObjectId(forcedSeller)) {
      console.error(`Invalid --seller id: ${forcedSeller}`);
      process.exit(1);
    }
    const u = await User.findById(forcedSeller).select("name mobile").lean();
    if (!u) { console.error(`No User found for ${forcedSeller}`); process.exit(1); }
    sellers = [u];
  } else {
    sellers = await User.find({}).select("name mobile").limit(10).lean();
  }
  if (!sellers.length) {
    console.error("No users found to act as sellers. Seed users first.");
    process.exit(1);
  }
  console.log(`Using ${sellers.length} seller(s).`);

  // Optional: link to the platform vendor profile if one exists (store feed
  // doesn't require it, but it keeps the data realistic).
  const vendor = await VendorProfile.findOne({}).select("_id").lean();
  if (vendor) console.log(`Linking items to vendor profile ${vendor._id}`);

  const products = buildProducts();

  // Idempotent re-run: clear previously-seeded items by name.
  const names = products.map((p) => p.itemName);
  const del = await EquipmentListing.deleteMany({ itemName: { $in: names } });
  if (del.deletedCount) console.log(`Cleared ${del.deletedCount} previously-seeded store item(s).`);

  const listedAt = new Date();
  const docs = products.map((p, i) => {
    const seller = sellers[i % sellers.length];
    return {
      seller: seller._id,
      sellerName: seller.name || "Player",
      sellerLevel: p.sellerLevel,
      sellerContact: seller.mobile || "9876543210",
      sport: p.sport,
      itemName: p.itemName,
      description: p.description,
      category: p.category,
      brand: p.brand,
      size: p.size,
      condition: p.condition,
      quantity: 1,
      originalPrice: p.originalPrice,
      askingPrice: p.askingPrice,    // resale price (matches publishProduct)
      vendorSalePrice: p.vendorSalePrice,
      isDonation: false,
      images: p.images,
      status: "Active",
      lifecycleStatus: "approved",
      vendorStatus: "listed",        // <-- the ONLY field the store feed filters on
      handledByVendor: vendor?._id || null,
      vendorTimeline: { listedAt, pickedUpAt: listedAt, soldAt: null },
    };
  });

  const created = await EquipmentListing.insertMany(docs);
  console.log(`\n✅ Seeded ${created.length} STORE-VISIBLE products (vendorStatus: "listed").`);

  // Per-sport summary
  const bySport = {};
  created.forEach((it) => { bySport[it.sport] = (bySport[it.sport] || 0) + 1; });
  Object.entries(bySport).forEach(([s, n]) => console.log(`   ${s}: ${n}`));
  console.log(`\nThey now appear in the store feed: GET /api/donations/listings\n`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Seed failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
