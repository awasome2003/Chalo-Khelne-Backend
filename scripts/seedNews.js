const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const News = require("../Modal/News");

const newsArticles = [
  {
    title: "Inter-City Badminton Championship 2026 — Registrations Open",
    body: "The much-awaited Inter-City Badminton Championship is back! This year, the tournament will feature players from over 25 cities competing across Men's Singles, Women's Singles, Men's Doubles, Women's Doubles, and Mixed Doubles categories. The championship follows BWF-standard rules with best-of-3 sets at 21 points each.\n\nEarly bird registration closes on April 5th. Players must have a minimum district-level ranking to participate. Prize pool worth ₹5,00,000 with trophies, medals, and certificates for top performers in each category.\n\nVenue: Shree Shiv Chhatrapati Sports Complex, Pune\nDates: April 18-22, 2026\nEntry Fee: ₹1,500 per player (Singles), ₹2,000 per pair (Doubles)",
    type: "Tournament Announcement",
    sports: ["Badminton"],
    region: "Maharashtra",
    area: "Pune",
    status: "Published",
    publishDate: new Date("2026-03-15"),
    expiryDate: new Date("2026-04-22"),
    viewCount: 342,
  },
  {
    title: "Football Premier League Season 4 Kicks Off This Weekend",
    body: "Season 4 of the Chalo Khelne Football Premier League begins this Saturday with 16 teams battling for the ultimate glory. The league stage runs for 8 weeks followed by knockout quarterfinals, semifinals, and the grand final.\n\nNew this season: VAR-assisted refereeing for semifinal and final matches, live score streaming on the app, and a dedicated fan zone at each venue. Teams are divided into 4 groups of 4 for the round-robin stage.\n\nAll matches will be played on premium artificial turf grounds across Mumbai. Match schedules are available on the app — download now to track your favorite team's journey!",
    type: "Tournament Announcement",
    sports: ["Football"],
    region: "Maharashtra",
    area: "Mumbai",
    status: "Published",
    publishDate: new Date("2026-03-14"),
    expiryDate: new Date("2026-06-30"),
    viewCount: 578,
  },
  {
    title: "Table Tennis State Rankings Updated After Nagpur Open",
    body: "The Maharashtra State Table Tennis Association has released updated player rankings following the conclusion of the Nagpur Open 2026. Over 180 players participated across Under-15, Under-19, and Open categories.\n\nKey highlights:\n• Arjun Mehta climbs to #2 in the state Open category after a dominant semifinal and final performance\n• Priya Deshmukh retains her #1 spot in the Women's category with 3 consecutive tournament wins\n• Under-15 category sees 5 new entries in the top 20\n• Nagpur district now has the highest number of ranked players in the state\n\nThe next ranking tournament is the Pune District Championship scheduled for April 2026. Rankings are recalculated after every sanctioned tournament.",
    type: "Sports News",
    sports: ["Table Tennis"],
    region: "Maharashtra",
    area: "Nagpur",
    status: "Published",
    publishDate: new Date("2026-03-13"),
    viewCount: 215,
  },
  {
    title: "New Indoor Courts Now Available at Sportz Arena, Kothrud",
    body: "Sportz Arena in Kothrud, Pune has completed its expansion project, adding 4 new indoor badminton courts and 2 table tennis halls with ITTF-approved flooring. The facility now offers a total of 8 badminton courts and 6 TT tables.\n\nNew amenities include:\n• Air-conditioned playing area with professional LED lighting\n• Dedicated warm-up zone with stretching area\n• Pro shop for equipment purchase and racket stringing\n• Cafe and lounge area for players and spectators\n• Parking for 50+ vehicles\n\nBooking is now live on Chalo Khelne. Introductory rates start at ₹400/hour for badminton and ₹250/hour for table tennis. Members get 20% off on all bookings.",
    type: "Club Updates",
    sports: ["Badminton", "Table Tennis"],
    region: "Maharashtra",
    area: "Pune",
    status: "Published",
    publishDate: new Date("2026-03-12"),
    viewCount: 487,
  },
  {
    title: "Cricket Coaching Camp for Juniors — Summer 2026 Batch",
    body: "Elite Cricket Academy announces its flagship Summer Coaching Camp for aspiring cricketers aged 8-16. The 6-week intensive program covers batting technique, bowling mechanics, fielding drills, match simulation, fitness conditioning, and mental toughness training.\n\nProgram details:\n• Duration: May 1 — June 15, 2026 (Mon-Sat, 6:00 AM — 9:00 AM)\n• Batches: Under-10, Under-13, Under-16 (max 20 per batch)\n• Coaching Staff: 4 certified NCA coaches + 2 fitness trainers\n• Includes: Kit bag, practice jersey, performance assessment report\n• Fee: ₹15,000 for the full program\n\nLimited seats — register through the Chalo Khelne app or visit Elite Cricket Academy, Hadapsar. Early registrations before April 10 get a complimentary batting gloves set.",
    type: "Training Announcement",
    sports: ["Cricket"],
    region: "Maharashtra",
    area: "Pune",
    status: "Published",
    publishDate: new Date("2026-03-11"),
    expiryDate: new Date("2026-05-01"),
    viewCount: 623,
  },
  {
    title: "Volleyball Beach Tournament — Goa Edition",
    body: "Chalo Khelne presents the first-ever Beach Volleyball Tournament in Goa! Teams of 2 will compete in a fast-paced knockout format on Calangute Beach. The tournament is open to both amateur and professional players.\n\nTournament Format:\n• 32 teams maximum, first-come-first-served registration\n• Best of 3 sets, 21 points per set (15 in deciding set)\n• Single elimination knockout with consolation bracket\n• Men's, Women's, and Mixed categories\n\nPrize Pool: ₹2,00,000 total across all categories\nRegistration Fee: ₹1,000 per team\nDate: April 12-13, 2026\nVenue: Calangute Beach, North Goa\n\nAccommodation packages available for outstation players. Contact us through the app for group booking discounts.",
    type: "Tournament Announcement",
    sports: ["Volleyball"],
    region: "Goa",
    area: "Calangute",
    status: "Published",
    publishDate: new Date("2026-03-10"),
    expiryDate: new Date("2026-04-13"),
    viewCount: 391,
  },
  {
    title: "Chess Grandmaster Simultaneous Exhibition in Bangalore",
    body: "International Master Rahul Sharma will host a simultaneous chess exhibition at the Bangalore Chess Club on March 30th. He will play against 30 participants simultaneously in a thrilling display of chess mastery.\n\nThis is a rare opportunity for club players to test their skills against a titled player. The event is open to all rated players with a minimum FIDE rating of 1200.\n\nEvent Details:\n• Date: March 30, 2026, 10:00 AM onwards\n• Venue: Bangalore Chess Club, Indiranagar\n• Entry: ₹500 per participant (includes lunch)\n• Prizes: Signed chess set for anyone who draws or wins\n\nSeats are limited to 30 — book through Chalo Khelne now. Spectators are welcome free of charge.",
    type: "Sports News",
    sports: ["Chess"],
    region: "Karnataka",
    area: "Bangalore",
    status: "Published",
    publishDate: new Date("2026-03-09"),
    expiryDate: new Date("2026-03-30"),
    viewCount: 178,
  },
  {
    title: "Basketball 3x3 Street Tournament — Delhi NCR",
    body: "The streets are the court! Chalo Khelne brings the 3x3 Basketball Street Tournament to Delhi NCR. Inspired by the Olympic 3x3 format, this high-energy tournament features 10-minute games, single-hoop play, and fast-paced action.\n\n64 teams will battle across 3 city locations — Connaught Place, Cyber Hub Gurgaon, and Noida Sector 18. Qualifying rounds at each location lead to the Grand Final at Select Citywalk.\n\nRules: FIBA 3x3 official rules, 12-second shot clock, games to 21 or 10 minutes\nTeam Size: 3 players + 1 substitute\nCategories: Open (18+), Under-18\nPrize Pool: ₹3,00,000\n\nRegistration closes April 1st. Music, food trucks, and fan engagement activities at every venue!",
    type: "Tournament Announcement",
    sports: ["Basketball"],
    region: "Delhi",
    area: "Delhi NCR",
    status: "Published",
    publishDate: new Date("2026-03-08"),
    expiryDate: new Date("2026-04-15"),
    viewCount: 445,
  },
  {
    title: "Pickleball Gaining Massive Popularity Across Indian Cities",
    body: "Pickleball continues its explosive growth trajectory in India, with the number of registered players on Chalo Khelne crossing 15,000 in just 6 months. The sport, which blends elements of tennis, badminton, and table tennis, is attracting players of all ages.\n\nKey trends:\n• 40% of new pickleball players are aged 35-55, making it the most inclusive racquet sport on the platform\n• Pune, Bangalore, and Hyderabad lead in facility bookings for pickleball courts\n• Weekend pickleball slot bookings have increased 300% since January 2026\n• 12 new dedicated pickleball facilities have been listed in the last quarter\n\nChalo Khelne is partnering with the All India Pickleball Association to organize state-level championships. Stay tuned for announcements in your region.\n\nNew to pickleball? Download the app to find courts near you and book your first session!",
    type: "Sports News",
    sports: ["Pickleball"],
    region: "Maharashtra",
    area: "Pune",
    status: "Published",
    publishDate: new Date("2026-03-07"),
    viewCount: 892,
  },
  {
    title: "Tennis Coaching Masterclass with Former Davis Cup Player",
    body: "Chalo Khelne Training Academy presents a 3-day Tennis Masterclass conducted by Arjun Kadhe, former India Davis Cup team member. The masterclass is designed for intermediate to advanced players looking to elevate their game.\n\nSession breakdown:\n• Day 1: Serve mechanics, return of serve, and first-strike tennis\n• Day 2: Net play, volley technique, and doubles strategy\n• Day 3: Match play analysis, mental conditioning, and competitive drills\n\nTimings: March 28-30, 2026, 7:00 AM — 11:00 AM\nVenue: MSLTA Tennis Complex, Dadar, Mumbai\nFee: ₹8,000 for all 3 days (includes video analysis of your game)\nBatch Size: Maximum 16 players\n\nCertificate of completion provided. Register through the Chalo Khelne app — limited spots remaining.",
    type: "Training Announcement",
    sports: ["Tennis"],
    region: "Maharashtra",
    area: "Mumbai",
    status: "Published",
    publishDate: new Date("2026-03-06"),
    expiryDate: new Date("2026-03-30"),
    viewCount: 334,
  },
  {
    title: "Kabaddi League — Village to City Championship Format Announced",
    body: "In a first-of-its-kind initiative, Chalo Khelne launches the Village to City Kabaddi Championship connecting grassroots talent with urban competitive kabaddi. The tournament follows a pyramid structure:\n\nPhase 1 — Village Qualifiers (April 2026): Open registration for teams from rural areas across Maharashtra. Top 2 teams from each taluka qualify.\n\nPhase 2 — District Rounds (May 2026): Qualified teams compete at district level. Winners advance to the city stage.\n\nPhase 3 — City Championship (June 2026): District champions face city-based professional teams in a round-robin + knockout format.\n\nHighlights:\n• No registration fee for village-level teams\n• Travel allowance provided for qualifying teams\n• Pro Kabaddi League scouts confirmed as observers at city stage\n• Total prize pool: ₹10,00,000\n\nRegistration opens April 1st on the Chalo Khelne app.",
    type: "Tournament Announcement",
    sports: ["Kabaddi"],
    region: "Maharashtra",
    status: "Published",
    publishDate: new Date("2026-03-05"),
    expiryDate: new Date("2026-06-30"),
    viewCount: 756,
  },
  {
    title: "Platform Update: Live Score Tracking Now Available for All Sports",
    body: "We're excited to announce that live score tracking is now available for all 15 supported sports on the Chalo Khelne platform! Tournament managers can now update scores in real-time during matches, and spectators can follow along from anywhere.\n\nWhat's new:\n• Real-time score push notifications for followed tournaments\n• Set-by-set scoring display for racquet sports\n• Live standings update during group stage tournaments\n• Match timeline with key events and milestones\n• Score sharing via WhatsApp and social media\n\nFor tournament managers: Simply tap the match card during an active tournament to start live scoring. The interface adapts automatically based on the sport's scoring format.\n\nThis feature is available on both web and mobile apps. Update your app to the latest version to access live scoring.",
    type: "Club Updates",
    sports: ["Badminton", "Table Tennis", "Tennis", "Cricket", "Football", "Basketball", "Volleyball", "Chess"],
    status: "Published",
    publishDate: new Date("2026-03-04"),
    viewCount: 1203,
  },
];

async function seedNews() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    // Check if we need a fallback user ID
    const User = require("../Modal/User");
    const Manager = require("../Modal/ClubManager").Manager;

    // Try to find any existing manager or user to use as createdBy
    let creator = await Manager.findOne().lean();
    let createdByModel = "Manager";

    if (!creator) {
      creator = await User.findOne().lean();
      createdByModel = "User";
    }

    if (!creator) {
      console.error("No users or managers found in DB. Please create at least one user first.");
      process.exit(1);
    }

    console.log(`Using ${createdByModel}: ${creator.name || creator.email || creator._id}`);

    // Clear existing news (optional — comment out to keep existing)
    const existing = await News.countDocuments();
    if (existing > 0) {
      console.log(`Found ${existing} existing news articles. Clearing...`);
      await News.deleteMany({});
    }

    // Insert all articles
    const articlesWithCreator = newsArticles.map((article) => ({
      ...article,
      createdBy: creator._id,
      createdByModel,
      createdByName: creator.name || "Admin",
    }));

    const result = await News.insertMany(articlesWithCreator);
    console.log(`\nSuccessfully seeded ${result.length} news articles:\n`);

    result.forEach((article, i) => {
      console.log(`  ${i + 1}. [${article.type}] ${article.title}`);
    });

    console.log("\nDone!");
    process.exit(0);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seedNews();
