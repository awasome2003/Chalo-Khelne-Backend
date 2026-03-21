require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Turf = require("../Modal/Turf");
const User = require("../Modal/User");

const allDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const makeSlots = (startHour, endHour, days = allDays) =>
  days.map((day) => ({ day, startTime: `${startHour}:00`, endTime: `${endHour}:00` }));

const turfs = [
  {
    name: "Striker's Arena",
    description: "Premium 5-a-side football turf with FIFA-approved artificial grass. Floodlit for night matches, surrounded by netting, and equipped with electronic scoreboards. Popular among corporate leagues and weekend warriors.",
    address: { fullAddress: "Plot 12, Hinjewadi Phase 2, Near Infosys Gate 3", area: "Hinjewadi", city: "Pune", pincode: "411057", coordinates: { lat: 18.5912, lng: 73.7380 } },
    sports: [
      { name: "Football", pricePerHour: 1200 },
      { name: "Cricket", pricePerHour: 1000 },
    ],
    facilities: { artificialTurf: true, floodLights: true, parking: true, drinkingWater: true, restrooms: true, firstAidKit: true, coldDrinks: true, wifi: true },
    availableTimeSlots: makeSlots(6, 23),
    ratings: { average: 4.5, count: 128 },
    reviews: [],
  },
  {
    name: "Smash Point Badminton Hub",
    description: "4 international-standard wooden court badminton facility with proper ceiling height of 12m. Yonex-approved courts with anti-slip flooring. Coaching sessions available on weekday mornings.",
    address: { fullAddress: "Ganga Dham, Near Sinhagad Road Signal", area: "Sinhagad Road", city: "Pune", pincode: "411030", coordinates: { lat: 18.4832, lng: 73.8168 } },
    sports: [
      { name: "Badminton", pricePerHour: 600 },
    ],
    facilities: { floodLights: true, ledLights: true, parking: true, drinkingWater: true, restrooms: true, lockerRooms: true, firstAidKit: true, shower: true },
    availableTimeSlots: makeSlots(5, 22),
    ratings: { average: 4.7, count: 95 },
    reviews: [],
  },
  {
    name: "PowerPlay Cricket Nets",
    description: "6-lane professional cricket practice nets with bowling machine facility. Each lane is 22 yards with proper mat pitch. Ideal for batsmen looking to perfect their technique. Weekend tournaments hosted monthly.",
    address: { fullAddress: "Balewadi Sports Complex, Opposite ICC Tower", area: "Balewadi", city: "Pune", pincode: "411045", coordinates: { lat: 18.5726, lng: 73.7688 } },
    sports: [
      { name: "Cricket", pricePerHour: 800 },
      { name: "Cricket Nets", pricePerHour: 500 },
    ],
    facilities: { artificialTurf: true, floodLights: true, parking: true, drinkingWater: true, coldDrinks: true, restrooms: true, grandstands: true, firstAidKit: true },
    availableTimeSlots: makeSlots(6, 21),
    ratings: { average: 4.3, count: 210 },
    reviews: [],
  },
  {
    name: "Rally Zone Tennis Academy",
    description: "2 clay courts and 1 hard court with professional-grade lighting. AITA-standard dimensions with proper run-off areas. Ball machine available for solo practice. Pro shop onsite with racket stringing.",
    address: { fullAddress: "Survey No. 45, Koregaon Park Extension", area: "Koregaon Park", city: "Pune", pincode: "411001", coordinates: { lat: 18.5362, lng: 73.8989 } },
    sports: [
      { name: "Tennis", pricePerHour: 900 },
    ],
    facilities: { floodLights: true, parking: true, drinkingWater: true, restrooms: true, lockerRooms: true, shower: true, loungeArea: true, coldDrinks: true, foodCourt: true, wifi: true },
    availableTimeSlots: makeSlots(6, 21),
    ratings: { average: 4.6, count: 67 },
    reviews: [],
  },
  {
    name: "TopSpin Table Tennis Arena",
    description: "8 Butterfly-certified TT tables with proper spacing and rubber flooring. Coaching programs for juniors and competitive players. Regular ranking tournaments every Saturday. AC hall with spectator seating.",
    address: { fullAddress: "3rd Floor, Phoenix Mall, Viman Nagar", area: "Viman Nagar", city: "Pune", pincode: "411014", coordinates: { lat: 18.5679, lng: 73.9143 } },
    sports: [
      { name: "Table Tennis", pricePerHour: 400 },
    ],
    facilities: { ledLights: true, parking: true, drinkingWater: true, restrooms: true, coldDrinks: true, wifi: true, loungeArea: true, surveillanceCameras: true },
    availableTimeSlots: makeSlots(9, 22),
    ratings: { average: 4.8, count: 156 },
    reviews: [],
  },
  {
    name: "Ace Sports Multi-Court",
    description: "Pune's largest multi-sport indoor facility spanning 25,000 sq ft. Houses basketball, volleyball, and futsal courts under one roof. Fully air-conditioned with wooden sprung flooring. Corporate events and birthday parties hosted.",
    address: { fullAddress: "Magarpatta City, Hadapsar", area: "Hadapsar", city: "Pune", pincode: "411028", coordinates: { lat: 18.5089, lng: 73.9260 } },
    sports: [
      { name: "Basketball", pricePerHour: 1500 },
      { name: "Volleyball", pricePerHour: 1000 },
      { name: "Football", pricePerHour: 1400 },
    ],
    facilities: { artificialTurf: true, floodLights: true, ledLights: true, parking: true, drinkingWater: true, restrooms: true, lockerRooms: true, shower: true, foodCourt: true, coldDrinks: true, wifi: true, loungeArea: true, surveillanceCameras: true, securityPersonnel: true, firstAidKit: true },
    availableTimeSlots: makeSlots(7, 23),
    ratings: { average: 4.4, count: 312 },
    reviews: [],
  },
  {
    name: "Dink Masters Pickleball Court",
    description: "4 dedicated pickleball courts with USAPA-standard markings. The first pickleball-only facility in Pune. Beginner-friendly with equipment rental available. Weekend socials and ladder leagues running year-round.",
    address: { fullAddress: "Lane 7, Aundh IT Park Road", area: "Aundh", city: "Pune", pincode: "411007", coordinates: { lat: 18.5583, lng: 73.8073 } },
    sports: [
      { name: "Pickleball", pricePerHour: 500 },
      { name: "Badminton", pricePerHour: 550 },
    ],
    facilities: { artificialTurf: true, ledLights: true, parking: true, drinkingWater: true, restrooms: true, coldDrinks: true, firstAidKit: true, wifi: true },
    availableTimeSlots: makeSlots(6, 21),
    ratings: { average: 4.9, count: 43 },
    reviews: [],
  },
  {
    name: "Goal Factory 7s Arena",
    description: "Two 7-a-side football pitches with shock-absorbing turf. Separate warm-up area and team dugouts. Live match streaming available for booked games. Hosts the popular Pune Night Football League.",
    address: { fullAddress: "Behind Chandani Chowk Signal, Bavdhan", area: "Bavdhan", city: "Pune", pincode: "411021", coordinates: { lat: 18.5191, lng: 73.7785 } },
    sports: [
      { name: "Football", pricePerHour: 1800 },
    ],
    facilities: { artificialTurf: true, multipleFields: true, floodLights: true, parking: true, drinkingWater: true, restrooms: true, grandstands: true, coldDrinks: true, foodCourt: true, firstAidKit: true, securityPersonnel: true, surveillanceCameras: true },
    availableTimeSlots: makeSlots(6, 24),
    ratings: { average: 4.2, count: 89 },
    reviews: [],
  },
  {
    name: "Chess Café & Arena",
    description: "Unique chess-focused venue with 20 tournament-grade sets. Digital clocks provided. Weekly rapid and blitz events rated by FIDE. Comfortable AC environment with café serving snacks and beverages during play.",
    address: { fullAddress: "FC Road, Near Garware Bridge", area: "FC Road", city: "Pune", pincode: "411004", coordinates: { lat: 18.5255, lng: 73.8409 } },
    sports: [
      { name: "Chess", pricePerHour: 200 },
    ],
    facilities: { ledLights: true, drinkingWater: true, restrooms: true, coldDrinks: true, foodCourt: true, wifi: true, loungeArea: true, parking: false },
    availableTimeSlots: makeSlots(10, 22),
    ratings: { average: 4.7, count: 72 },
    reviews: [],
  },
  {
    name: "Volley Nation Beach Court",
    description: "Pune's only sand volleyball courts — 2 beach volleyball pits with imported sand. Proper FIVB-height nets. Great for fitness enthusiasts looking for a fun outdoor workout. Lights available for evening sessions.",
    address: { fullAddress: "Boat Club Road, Near JW Marriott", area: "Boat Club Road", city: "Pune", pincode: "411001", coordinates: { lat: 18.5308, lng: 73.8808 } },
    sports: [
      { name: "Volleyball", pricePerHour: 700 },
    ],
    facilities: { floodLights: true, parking: true, drinkingWater: true, restrooms: true, shower: true, coldDrinks: true, firstAidKit: true },
    availableTimeSlots: makeSlots(6, 20),
    ratings: { average: 4.1, count: 34 },
    reviews: [],
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Find a user to set as owner
    const owner = await User.findOne({});
    if (!owner) {
      console.error("No users found in DB. Create a user first.");
      process.exit(1);
    }
    console.log(`Using owner: ${owner.name} (${owner._id})`);

    // Check existing turfs
    const existingCount = await Turf.countDocuments();
    console.log(`Existing turfs: ${existingCount}`);

    let created = 0;
    for (const turfData of turfs) {
      // Skip if turf with same name exists
      const exists = await Turf.findOne({ name: turfData.name });
      if (exists) {
        console.log(`  ⏭ "${turfData.name}" already exists, skipping`);
        continue;
      }

      await Turf.create({
        ...turfData,
        owner: owner._id,
        isActive: true,
        images: [],
      });
      console.log(`  ✅ Created "${turfData.name}"`);
      created++;
    }

    console.log(`\nDone! Created ${created} turfs. Total: ${existingCount + created}`);
    process.exit(0);
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }
}

seed();
