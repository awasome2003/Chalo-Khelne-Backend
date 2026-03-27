require("dotenv").config();
const mongoose = require("mongoose");
const ForumCategory = require("../Modal/ForumCategory");

const CATEGORIES = [
  { name: "General", slug: "general", description: "General sports discussions", icon: "💬", color: "#004E93", order: 1 },
  { name: "Table Tennis", slug: "table-tennis", description: "TT strategies, equipment, tournaments", icon: "🏓", color: "#FF6A00", order: 2 },
  { name: "Badminton", slug: "badminton", description: "Shuttlecock talk", icon: "🏸", color: "#059669", order: 3 },
  { name: "Cricket", slug: "cricket", description: "Cricket discussions", icon: "🏏", color: "#1D6A8B", order: 4 },
  { name: "Football", slug: "football", description: "Football tactics and news", icon: "⚽", color: "#3B82F6", order: 5 },
  { name: "Tennis", slug: "tennis", description: "Tennis community", icon: "🎾", color: "#84CC16", order: 6 },
  { name: "Chess", slug: "chess", description: "Strategy and openings", icon: "♟️", color: "#374151", order: 7 },
  { name: "Tournament Talk", slug: "tournament-talk", description: "Discuss upcoming and past tournaments", icon: "🏆", color: "#F59E0B", order: 8 },
  { name: "Training & Fitness", slug: "training-fitness", description: "Training tips and routines", icon: "💪", color: "#EF4444", order: 9 },
  { name: "Equipment", slug: "equipment", description: "Gear reviews and recommendations", icon: "🎯", color: "#8B5CF6", order: 10 },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  for (const cat of CATEGORIES) {
    const existing = await ForumCategory.findOne({ slug: cat.slug });
    if (existing) {
      console.log(`  Skip (exists): ${cat.name}`);
      continue;
    }
    await ForumCategory.create(cat);
    console.log(`  Created: ${cat.name}`);
  }

  console.log("Done — seeded", CATEGORIES.length, "forum categories");
  process.exit(0);
})();
