/*
 * Seeds the Sports Jobs & Opportunities marketplace:
 *   - JobPosting documents (browse list + job detail)
 *   - ProfessionalProfile documents attached to a few real users
 *     (so the "Hire Professional" directory is populated)
 *
 * Run:  node scripts/seedJobs.js
 *
 * Idempotent: job postings upsert by title; professional profiles upsert
 * by { userId, role }, so re-running refreshes without duplicates.
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const JobPosting = require("../Modal/JobPosting");
const ProfessionalProfile = require("../Modal/ProfessionalProfile");
const User = require("../Modal/User");

const JOBS = [
  {
    title: "Referee Needed",
    role: "referee",
    sport: "Cricket",
    venue: "Andheri Sports Complex",
    location: "Baner, Pune",
    address:
      "H.A. School, PBA SPORTS, near PBA SPORTS Welfare Centre, Hindustan Antibiotics Colony, Pimpri Colony, Pune, Maharashtra 411018",
    managerName: "Sagar Talekar (Manager)",
    organizer: {
      name: "Mumbai Premier League",
      description: "Professional cricket tournament organizer with 5+ years experience",
      rating: 4.8,
      events: 24,
      successRate: 98,
    },
    description:
      "Officiate matches fairly, enforce ICC rules, manage on-field decisions and keep the game flowing.",
    about: "Mumbai Premier League is hiring an experienced referee for its upcoming knockout stage.",
    schedule: [
      { title: "Semi-Final 1", date: "Friday, 15 May", time: "9:00 AM - 1:00 PM" },
      { title: "Semi-Final 2", date: "Saturday, 16 May", time: "9:00 AM - 1:00 PM" },
      { title: "Final", date: "Sunday, 17 May", time: "9:00 AM - 1:00 PM" },
    ],
    requirements: [
      "Minimum 2 years of cricket refereeing experience",
      "Knowledge of ICC cricket rules and regulations.",
      "Ability to handle pressure situations.",
      "Good physical fitness.",
      "Certification from recognized cricket association (preferred).",
    ],
    benefits: [
      "Certificate of participation.",
      "Networking opportunities with professional cricket organizers.",
      "Meals and refreshments provided.",
      "Free tournament merchandise.",
    ],
    rate: 799,
    rateUnit: "per hour",
    ratePerMatch: 2500,
    matches: 3,
    estimatedEarnings: 7500,
  },
  {
    title: "Coach Needed",
    role: "coach",
    sport: "Football",
    venue: "Powai Sports Arena",
    location: "Powai, Mumbai",
    managerName: "Vikram Patel (Manager)",
    organizer: {
      name: "Powai United FC",
      description: "Grassroots football club running youth development camps.",
      rating: 4.6,
      events: 18,
      successRate: 94,
    },
    description: "Lead training drills, plan sessions and mentor a youth squad through the season.",
    about: "Powai United FC needs a certified coach for its weekend youth academy.",
    schedule: [
      { title: "Session Block 1", date: "Saturday, 18 Oct", time: "7:00 AM - 9:00 AM" },
      { title: "Session Block 2", date: "Sunday, 19 Oct", time: "7:00 AM - 9:00 AM" },
    ],
    requirements: [
      "AFC / UEFA coaching license preferred.",
      "Experience coaching youth (U-14 to U-18).",
      "Strong communication skills.",
    ],
    benefits: ["Travel allowance.", "Season-long engagement.", "Club merchandise."],
    rate: 1200,
    rateUnit: "per hour",
    ratePerMatch: 3000,
    matches: 8,
    estimatedEarnings: 24000,
  },
  {
    title: "Cameraman Needed",
    role: "cameraman",
    sport: "Cricket",
    venue: "DY Patil Stadium",
    location: "Navi Mumbai",
    managerName: "Neha Iyer (Manager)",
    organizer: {
      name: "SportsReel Media",
      description: "Live sports broadcast and highlights production house.",
      rating: 4.9,
      events: 40,
      successRate: 97,
    },
    description: "Capture multi-angle match footage and key highlight moments for live broadcast.",
    about: "SportsReel Media is hiring camera operators for a televised tournament.",
    schedule: [{ title: "Match Day", date: "22 Oct 2026", time: "10:00 AM - 6:00 PM" }],
    requirements: [
      "Experience with broadcast / DSLR video rigs.",
      "Understanding of cricket play to anticipate action.",
      "Own equipment preferred.",
    ],
    benefits: ["Daily payout.", "Footage credits.", "Meals provided."],
    rate: 999,
    rateUnit: "per hour",
    ratePerMatch: 4000,
    matches: 2,
    estimatedEarnings: 8000,
  },
  {
    title: "Commentator Needed",
    role: "commentator",
    sport: "Badminton",
    venue: "Pune Badminton Hall",
    location: "Kothrud, Pune",
    managerName: "Rohan Joshi (Manager)",
    organizer: {
      name: "Pune Shuttlers League",
      description: "City-level badminton league with a growing fan following.",
      rating: 4.7,
      events: 12,
      successRate: 95,
    },
    description: "Provide energetic play-by-play and analysis for live-streamed matches.",
    about: "Pune Shuttlers League needs a bilingual commentator for the finals weekend.",
    schedule: [{ title: "Finals Weekend", date: "25 Oct 2026", time: "4:00 PM - 9:00 PM" }],
    requirements: [
      "Prior commentary experience.",
      "Strong knowledge of badminton rules and players.",
      "Clear diction in English & Hindi.",
    ],
    benefits: ["On-air credit.", "Networking with broadcasters.", "Refreshments."],
    rate: 1500,
    rateUnit: "per hour",
    ratePerMatch: 3500,
    matches: 2,
    estimatedEarnings: 7000,
  },
  {
    title: "Scorer Needed",
    role: "scorer",
    sport: "Cricket",
    venue: "NCA Ground",
    location: "Bandra, Mumbai",
    managerName: "Priya Singh (Manager)",
    organizer: {
      name: "Bandra Cricket Board",
      description: "Local cricket board organizing weekend leagues.",
      rating: 4.5,
      events: 30,
      successRate: 92,
    },
    description: "Maintain accurate ball-by-ball scoring and update the digital scoreboard.",
    about: "Bandra Cricket Board needs a reliable scorer for league fixtures.",
    schedule: [{ title: "League Fixtures", date: "28 Oct 2026", time: "8:00 AM - 5:00 PM" }],
    requirements: [
      "Familiar with cricket scoring apps.",
      "High attention to detail.",
      "Available full match days.",
    ],
    benefits: ["Per-match payout.", "Experience certificate."],
    rate: 699,
    rateUnit: "per hour",
    ratePerMatch: 2000,
    matches: 4,
    estimatedEarnings: 8000,
  },
];

// Professional profiles to attach to real users (by array index of fetched users)
const PROFILE_TEMPLATES = [
  {
    role: "referee",
    sports: ["Cricket"],
    city: "Mumbai",
    experienceLevel: "intermediate",
    availability: ["weekends_only"],
    rateType: "per_hour",
    rateAmount: 1200,
    negotiable: true,
    about: "Experienced cricket referee with 3+ years officiating local and state-level tournaments.",
    rating: 4.8,
    reviewCount: 42,
  },
  {
    role: "commentator",
    sports: ["Cricket", "Football"],
    city: "Pune",
    experienceLevel: "professional",
    availability: ["event_based", "flexible_hours"],
    rateType: "per_match",
    rateAmount: 2500,
    negotiable: false,
    about: "Energetic bilingual commentator covering cricket and football across the region.",
    rating: 4.9,
    reviewCount: 31,
  },
  {
    role: "coach",
    sports: ["Football"],
    city: "Mumbai",
    experienceLevel: "experienced",
    availability: ["part_time"],
    rateType: "per_day",
    rateAmount: 3000,
    negotiable: true,
    about: "UEFA-B licensed coach specializing in youth football development.",
    rating: 4.7,
    reviewCount: 25,
  },
  {
    role: "cameraman",
    sports: ["Cricket", "Basketball"],
    city: "Navi Mumbai",
    experienceLevel: "professional",
    availability: ["event_based"],
    rateType: "per_day",
    rateAmount: 4000,
    negotiable: false,
    about: "Broadcast camera operator with experience on televised sports events.",
    rating: 4.6,
    reviewCount: 18,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // ── Job postings ──
    let jCreated = 0;
    let jUpdated = 0;
    for (const job of JOBS) {
      const existing = await JobPosting.findOne({ title: job.title, venue: job.venue });
      if (existing) {
        await JobPosting.updateOne({ _id: existing._id }, { $set: job });
        jUpdated++;
        console.log(`  job updated  ${job.title}`);
      } else {
        await JobPosting.create(job);
        jCreated++;
        console.log(`  job created  ${job.title}`);
      }
    }

    // ── Professional profiles attached to real users ──
    const users = await User.find({ isActive: true })
      .select("_id name")
      .sort({ updatedAt: -1 })
      .limit(PROFILE_TEMPLATES.length)
      .lean();

    let pCreated = 0;
    let pUpdated = 0;
    if (users.length === 0) {
      console.log("  (no users found — skipped professional profiles)");
    } else {
      for (let i = 0; i < users.length; i++) {
        const tpl = PROFILE_TEMPLATES[i % PROFILE_TEMPLATES.length];
        const userId = users[i]._id;
        const existing = await ProfessionalProfile.findOne({ userId, role: tpl.role });
        if (existing) {
          Object.assign(existing, tpl);
          await existing.save();
          pUpdated++;
          console.log(`  profile updated  ${users[i].name} → ${tpl.role}`);
        } else {
          await ProfessionalProfile.create({ ...tpl, userId });
          pCreated++;
          console.log(`  profile created  ${users[i].name} → ${tpl.role}`);
        }
      }
    }

    console.log(
      `\nDone. Jobs: ${jCreated} created / ${jUpdated} updated. Profiles: ${pCreated} created / ${pUpdated} updated.`
    );
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
