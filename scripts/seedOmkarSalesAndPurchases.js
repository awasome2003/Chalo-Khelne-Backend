/*
 * Seeds a mix of "Sold" listings for Omkar:
 *   - 4 items he sold (seller = Omkar, claimedBy = a random other user)
 *   - 4 items he bought  (seller = a random other user, claimedBy = Omkar)
 *
 * Run:  node scripts/seedOmkarSalesAndPurchases.js
 *
 * Idempotent: any previous run by this script (tagged via `notes: "seed:omkar-sales-purchases"`)
 * is removed first so re-running gives a clean state.
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const EquipmentListing = require("../Modal/EquipmentListing");
const User = require("../Modal/User");

const OMKAR_ID = "6943a037944d899a354224a5";
const SEED_TAG = "seed:omkar-sales-purchases";

// ─── Items Omkar SOLD (he was the seller) ──────────────────────────────
const soldByOmkar = [
  {
    sport: "Cricket",
    itemName: "MRF Genius Grand Edition",
    description:
      "Used during 2 club tournaments. Sweet spot intact, edges still strong. Comes with bat cover.",
    category: "Bat",
    brand: "MRF",
    size: "SH",
    color: "Yellow",
    condition: "Good",
    originalPrice: 8500,
    askingPrice: 4200,
    quantity: 1,
    usageDuration: "8 months",
    features: ["English Willow", "Grade 2"],
  },
  {
    sport: "Football",
    itemName: "Nike Mercurial Vapor 15",
    description:
      "Worn for one league season. Studs in great shape. UK 9 / IN 8. Original box included.",
    category: "Shoes",
    brand: "Nike",
    size: "9",
    color: "Black",
    condition: "Like New",
    originalPrice: 12999,
    askingPrice: 6800,
    quantity: 1,
    usageDuration: "1 season",
    features: ["FG studs", "Lightweight"],
  },
  {
    sport: "Badminton",
    itemName: "Yonex Astrox 88D Pro",
    description:
      "Head-heavy attacking racket. Used at state-level coaching camp. Strung at 28 lbs. Mint condition.",
    category: "Racket",
    brand: "Yonex",
    size: "4U G5",
    color: "Red",
    condition: "Good",
    originalPrice: 17500,
    askingPrice: 9500,
    quantity: 1,
    usageDuration: "10 months",
    features: ["Head-heavy", "Restrung"],
  },
  {
    sport: "Tennis",
    itemName: "Wilson Pro Staff 97",
    description:
      "Played with this for 18 months. Frame in solid shape, no cracks. Grip recently replaced.",
    category: "Racket",
    brand: "Wilson",
    size: "L3",
    color: "Black",
    condition: "Good",
    originalPrice: 16000,
    askingPrice: 7800,
    quantity: 1,
    usageDuration: "18 months",
    features: ["Pro Staff line", "New grip"],
  },
];

// ─── Items Omkar BOUGHT (he was the buyer/claimer) ─────────────────────
const boughtByOmkar = [
  {
    sport: "Basketball",
    itemName: "Spalding NBA Replica",
    description:
      "Official replica leather ball. Used a few times outdoors, still grips well. Holds pressure.",
    category: "Ball",
    brand: "Spalding",
    size: "7",
    color: "Orange",
    condition: "Good",
    originalPrice: 4500,
    askingPrice: 1900,
    quantity: 1,
    usageDuration: "6 months",
    features: ["Indoor/Outdoor"],
  },
  {
    sport: "Cricket",
    itemName: "SG Test Pro Pads (RH)",
    description:
      "Right-hand batting pads. Foam padding intact, all straps working. Light usage marks.",
    category: "Protective Gear",
    brand: "SG",
    size: "L",
    color: "White",
    condition: "Good",
    originalPrice: 4200,
    askingPrice: 1700,
    quantity: 1,
    usageDuration: "1 season",
    features: ["Right Handed"],
  },
  {
    sport: "Football",
    itemName: "Adidas Tiro Training Jersey",
    description:
      "Breathable training jersey, size M. Washed and folded. No fading or tears.",
    category: "Jersey",
    brand: "Adidas",
    size: "M",
    color: "Blue",
    condition: "Like New",
    originalPrice: 2200,
    askingPrice: 950,
    quantity: 1,
    usageDuration: "3 months",
    features: ["Breathable"],
  },
  {
    sport: "Table Tennis",
    itemName: "Butterfly Tenergy 05 (Pair)",
    description:
      "Sealed second pair, never glued onto a blade. Original packaging intact.",
    category: "Accessories",
    brand: "Butterfly",
    size: "2.1mm",
    color: "Red",
    condition: "Like New",
    originalPrice: 5800,
    askingPrice: 2900,
    quantity: 1,
    usageDuration: "Unused",
    features: ["Sealed pair"],
  },
];

const buildShipping = (user) => ({
  mobile: user.mobile || "9876543210",
  email: user.email || "",
  address: user.address || "Hostel Lane, Pune",
  pincode: "411045",
  state: "Maharashtra",
  city: "Pune",
});

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const omkar = await User.findById(OMKAR_ID).lean();
    if (!omkar) {
      console.error(`User ${OMKAR_ID} not found. Aborting.`);
      process.exit(1);
    }
    console.log(`Seeding sales/purchases for ${omkar.name} (${omkar._id})`);

    // Pool of other users to act as counterparties (sellers when Omkar buys,
    // buyers when Omkar sells)
    const others = await User.find({ _id: { $ne: OMKAR_ID } }).limit(10);
    if (others.length === 0) {
      console.error("Need at least one other user in the DB to play the counterparty role.");
      process.exit(1);
    }
    console.log(`Found ${others.length} counterparty user(s)`);

    // Idempotency: clear previous output from this script
    const cleared = await EquipmentListing.deleteMany({ notes: SEED_TAG });
    if (cleared.deletedCount) {
      console.log(`Cleared ${cleared.deletedCount} previously-seeded listings`);
    }

    const now = new Date();
    const daysAgo = (n) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d;
    };

    // ─── Listings Omkar sold ─────────────────────────────────────────
    const soldDocs = soldByOmkar.map((item, i) => {
      const buyer = others[i % others.length];
      const createdAt = daysAgo(20 + i * 2);
      const claimedAt = daysAgo(5 + i);
      return {
        ...item,
        seller: omkar._id,
        sellerName: omkar.name || "Omkar",
        sellerLevel: "club",
        sellerContact: omkar.mobile || "1234567890",
        isDonation: false,
        status: "Sold",
        lifecycleStatus: "approved",
        paymentStatus: "Verified",
        paymentMethod: "upi",
        deliveryStatus: "delivered",
        claimedBy: buyer._id,
        claimedByName: buyer.name || "Buyer",
        claimedAt,
        verifiedAt: claimedAt,
        buyerContact: buyer.mobile || "9000000000",
        shippingAddress: buildShipping(omkar),
        views: 20 + Math.floor(Math.random() * 100),
        images: [],
        createdAt,
        updatedAt: claimedAt,
        notes: SEED_TAG,
      };
    });

    // ─── Listings Omkar bought ───────────────────────────────────────
    const boughtDocs = boughtByOmkar.map((item, i) => {
      const seller = others[(i + 1) % others.length];
      const createdAt = daysAgo(25 + i * 2);
      const claimedAt = daysAgo(2 + i);
      return {
        ...item,
        seller: seller._id,
        sellerName: seller.name || "Seller",
        sellerLevel: "club",
        sellerContact: seller.mobile || "9000000000",
        isDonation: false,
        status: "Sold",
        lifecycleStatus: "approved",
        paymentStatus: "Verified",
        paymentMethod: "upi",
        deliveryStatus: "delivered",
        claimedBy: omkar._id,
        claimedByName: omkar.name || "Omkar",
        claimedAt,
        verifiedAt: claimedAt,
        buyerContact: omkar.mobile || "1234567890",
        shippingAddress: buildShipping(omkar),
        views: 15 + Math.floor(Math.random() * 80),
        images: [],
        createdAt,
        updatedAt: claimedAt,
        notes: SEED_TAG,
      };
    });

    const created = await EquipmentListing.insertMany([...soldDocs, ...boughtDocs]);
    console.log(`Inserted ${created.length} listings:`);

    let income = 0;
    let spent = 0;
    created.forEach((item) => {
      const role =
        item.seller.toString() === OMKAR_ID ? "SOLD  " : "BOUGHT";
      if (role === "SOLD  ") income += item.askingPrice;
      else spent += item.askingPrice;
      console.log(
        `  [${role}] ${item.sport.padEnd(11)} ${item.itemName.padEnd(32)} ₹${item.askingPrice}`
      );
    });
    console.log(`\nTotal earned by Omkar: ₹${income}`);
    console.log(`Total spent by Omkar : ₹${spent}`);

    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
