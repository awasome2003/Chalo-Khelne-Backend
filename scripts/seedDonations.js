const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const EquipmentListing = require("../Modal/EquipmentListing");
const User = require("../Modal/User");

const equipmentData = [
  {
    sport: "Badminton",
    itemName: "Yonex Astrox 99 Pro",
    description: "Used this racket for 2 years at national level tournaments. String tension maintained at 28 lbs. Minor cosmetic scratches on the frame but performance is still top-notch. Comes with original cover and extra grip.",
    category: "Racket",
    condition: "Good",
    originalPrice: 12500,
    askingPrice: 6500,
    sellerLevel: "national",
    images: [],
  },
  {
    sport: "Badminton",
    itemName: "Li-Ning Windstorm 72",
    description: "Lightweight racket perfect for doubles. Used at state level for 1 season. Restrung recently with BG65 strings. Excellent condition, barely any signs of wear.",
    category: "Racket",
    condition: "Like New",
    originalPrice: 8900,
    askingPrice: 5200,
    sellerLevel: "state",
    images: [],
  },
  {
    sport: "Badminton",
    itemName: "Yonex Power Cushion 65Z Shoes",
    description: "Size UK 9. Worn for about 6 months during training sessions. Sole still has good grip. Giving away for free to support upcoming players. These are great for court movement.",
    category: "Shoes",
    condition: "Fair",
    originalPrice: 7500,
    askingPrice: 0,
    sellerLevel: "state",
    images: [],
  },
  {
    sport: "Cricket",
    itemName: "SG Test Opening Bat",
    description: "English willow, Grade 1. Used in district tournaments for one season. Well-knocked and ready to play. Has 3-4 minor dents on the edge but sweet spot is intact. Comes with bat cover.",
    category: "Bat",
    condition: "Good",
    originalPrice: 15000,
    askingPrice: 7000,
    sellerLevel: "district",
    images: [],
  },
  {
    sport: "Cricket",
    itemName: "SS Gladiator Batting Pads",
    description: "Right-handed batting pads. Used for one season at club level. All straps intact, good cushioning. Clean and well-maintained. Suitable for intermediate players.",
    category: "Protective Gear",
    condition: "Good",
    originalPrice: 3500,
    askingPrice: 1500,
    sellerLevel: "club",
    images: [],
  },
  {
    sport: "Tennis",
    itemName: "Wilson Pro Staff RF97 Autograph",
    description: "Roger Federer signature edition. Played with this at state championships for 2 years. Head size 97 sq in, weight 340g. Restrung with Luxilon ALU Power. Grip size 3. Frame in excellent condition.",
    category: "Racket",
    condition: "Good",
    originalPrice: 22000,
    askingPrice: 11000,
    sellerLevel: "state",
    images: [],
  },
  {
    sport: "Table Tennis",
    itemName: "Butterfly Timo Boll ALC Blade",
    description: "Professional blade with arylate carbon layers. Used at national ranking tournaments. Comes without rubbers. The blade face has minimal wear marks. Perfect for advanced players looking for a fast attacking blade.",
    category: "Bat",
    condition: "Like New",
    originalPrice: 18000,
    askingPrice: 10000,
    sellerLevel: "national",
    images: [],
  },
  {
    sport: "Table Tennis",
    itemName: "Stiga Pro Tournament Table",
    description: "Full-size ITTF-approved table. Used in our club for 3 years. Surface is in good condition with minor scratches. Net included. Buyer needs to arrange pickup — it's heavy! Donating it free since upgrading to a new one.",
    category: "Other",
    condition: "Fair",
    originalPrice: 45000,
    askingPrice: 0,
    sellerLevel: "club",
    images: [],
  },
  {
    sport: "Football",
    itemName: "Nike Mercurial Superfly 8 Elite",
    description: "Size UK 10. Firm ground studs. Used for one season in state-level matches. These boots have amazing ball control. Flyknit upper is still in great shape. Selling because I switched to a different model.",
    category: "Shoes",
    condition: "Good",
    originalPrice: 16000,
    askingPrice: 7500,
    sellerLevel: "state",
    images: [],
  },
  {
    sport: "Football",
    itemName: "Adidas Team Jersey Set (Full Team)",
    description: "Complete set of 16 jerseys + shorts in blue and white. Custom printed numbers 1-16. Used for one tournament season. All pieces washed and in good condition. Donating free to any team that needs uniforms.",
    category: "Jersey",
    condition: "Good",
    originalPrice: 24000,
    askingPrice: 0,
    sellerLevel: "district",
    images: [],
  },
  {
    sport: "Basketball",
    itemName: "Spalding NBA Official Game Ball",
    description: "Genuine leather basketball. Used in district championship games. Still holds air perfectly, leather is broken in for great grip. Ideal for indoor courts.",
    category: "Ball",
    condition: "Good",
    originalPrice: 8000,
    askingPrice: 3500,
    sellerLevel: "district",
    images: [],
  },
  {
    sport: "Volleyball",
    itemName: "Mikasa V200W Official Match Ball",
    description: "FIVB-approved match ball. Used for state-level matches. Excellent grip and flight consistency. No visible wear. Comes with ball pump.",
    category: "Ball",
    condition: "Like New",
    originalPrice: 5500,
    askingPrice: 3000,
    sellerLevel: "state",
    images: [],
  },
  {
    sport: "Pickleball",
    itemName: "Joola Ben Johns Hyperion CFS 16mm",
    description: "Carbon fiber paddle used at national pickleball tournament. Edge guard has minor scuffs but playing surface is perfect. Comes with paddle cover. Great for power hitters.",
    category: "Racket",
    condition: "Good",
    originalPrice: 14000,
    askingPrice: 7500,
    sellerLevel: "national",
    images: [],
  },
  {
    sport: "Hockey",
    itemName: "Grays GR11000 Probow",
    description: "Pro-level hockey stick. 36.5 inches. Used at national camp training. Carbon content 90%. Probow shape for drag flicks. Giving away free to support a young player who can't afford pro equipment.",
    category: "Accessories",
    condition: "Fair",
    originalPrice: 20000,
    askingPrice: 0,
    sellerLevel: "national",
    images: [],
  },
  {
    sport: "Chess",
    itemName: "DGT Electronic Chess Board",
    description: "Tournament-grade electronic board with piece recognition. Used at state chess championship for 2 years. All pieces present, board sensors working perfectly. Includes USB cable and carrying bag.",
    category: "Other",
    condition: "Good",
    originalPrice: 35000,
    askingPrice: 18000,
    sellerLevel: "state",
    images: [],
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Find some users to act as sellers
    const users = await User.find({}).limit(5);
    if (users.length === 0) {
      console.error("No users found in database. Please create users first.");
      process.exit(1);
    }

    console.log(`Found ${users.length} users to use as sellers`);

    // Clear existing listings
    await EquipmentListing.deleteMany({});
    console.log("Cleared existing equipment listings");

    // Create listings, cycling through available users as sellers
    const listings = equipmentData.map((item, index) => {
      const seller = users[index % users.length];
      return {
        ...item,
        seller: seller._id,
        sellerName: seller.name || seller.firstName || "Player",
        sellerContact: seller.mobile || seller.phone || "9876543210",
        isDonation: item.askingPrice === 0,
        status: "Active",
      };
    });

    const created = await EquipmentListing.insertMany(listings);
    console.log(`Successfully seeded ${created.length} equipment listings:`);

    created.forEach((item) => {
      console.log(`  - ${item.sport}: ${item.itemName} (${item.isDonation ? "FREE" : "₹" + item.askingPrice}) by ${item.sellerName}`);
    });

    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
