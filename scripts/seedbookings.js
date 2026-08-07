// Mongoose version — run with: node seedbookings.js
// Uses your project's existing 'mongoose' dependency, no extra install needed.
//
// CHANGE FROM PREVIOUS VERSION:
// Doubles / Mixed Doubles no longer get tacked on as a category string on each
// player's individual booking. Each pair now gets its OWN booking document,
// with both players linked via `team.players`. Singles still get one booking
// per player. This mirrors the real partnerships from the sign-up sheet
// (e.g. "Sharang Mittal & Karan Bajaj" is one Men's Doubles booking, not two
// separate players each vaguely flagged "Men's Doubles").

const mongoose = require('mongoose');

const uri = "mongodb+srv://admin:admin@cluster0.hau6pj8.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0";
// ^ change 'test' in the path above if your actual database name is different

const TT_SPORT_ID = new mongoose.Types.ObjectId('69b7ce0cf50e303a19ed6110');
const TOURNAMENT_ID = new mongoose.Types.ObjectId('6a6dacbec75705d6089838fa');
const CLUB_ID = new mongoose.Types.ObjectId('67dd59de71d08e6633cd3531');
const TOURNAMENT_NAME = "Multi-Sport Championship — Badminton · Carrom · Table Tennis";

// -------------------------------------------------------------------------
// SIGN-UP DATA — pulled straight from the participants sheet.
// SINGLES: { "Category Name": ["Player", ...] }
// PAIRS:   { "Category Name": [["Player A", "Player B"], ...] }
// -------------------------------------------------------------------------

const SINGLES = {
  "Men's Singles": ["Mahesh Patil","Saurabh Patel","Gavara Rambabu","Sharang Mittal","Aakash Sharma","Dnyaneshwar Khonde","DEEPANSHU DUBEY","Abhishek Saraf","Vivek Patil","Abhishek S","Manish Garg","Lalitesh Vaidyar","Avinash Singh Panwar","Vikas Shinde","Rajneesh Mehra","Shashank Naik","Nikhil Kashyap","Rinkesh Mehar","Manoj Nemani","Vivek Kumar Verma","Akash Kumar","Pavan Dhake","Avinash Dharamdasani","GOBI SUBRAMANI","Ashwin Lagji","Yuvraj Rajendra Mule","Bhabani Sankar Rath","Rohit Giri","Aman Bhatt","Abhishek Shrikrishna Patkar","Krishna Agrawal","Harshal Luniya","NILESH MOLE","Adeel Ahmad","Omkar Devakate","Prasun Bajpai","Harjeet Ajmani","Shubham Jadam","Pratik Gondhiya","Pornthep Monthongdee","Karan Patel","Abhineet Sharma","Ajit Singh","Karan Bajaj","Chander Wason"],
  "Women's Singles": ["Ria David","Purva Shambharkar","Srishti Golchha","Sarveshwari Umre","Mansi Khodke","Shriya Ukadgaonkar","Vishakha Patil","Saloni Kachhwah"],
};

const PAIRS = {
  "Men's Doubles": [
    ["Sharang Mittal","Karan Bajaj"],["Adwait Phodkar","Adeel Ahmad"],["Aakash Sharma","Rohit Giri"],
    ["DEEPANSHU DUBEY","Omkar Devakate"],["Abhishek Saraf","Vivek Kumar Verma"],["Abhishek S","Pavan Dhake"],
    ["Manish Garg","Krishna Agrawal"],["Lalitesh Vaidyar","Harjeet Ajmani"],["Vikas Shinde","Abhineet Sharma"],
    ["Rajneesh Mehra","Ashwin Lagji"],["Nikhil Kashyap","Shubham Jadam"],["Manoj Nemani","Pratik Gondhiya"],
    ["Akash Kumar","Aman Bhatt"],["Avinash Dharamdasani","Harshal Luniya"],["GOBI SUBRAMANI","Abhishek Shrikrishna Patkar"],
  ],
  "Women's Doubles": [
    ["Ria David","Saloni Kachhwah"],["Purva Shambharkar","Vishakha Patil"],
    ["Aditi Goel","Mansi Khodke"],["Srishti Golchha","Sarveshwari Umre"],
  ],
  // Note: the original sheet had "Rajneesh Mehra & Aditi Goel", "Ria David & Harshal
  // Luniya" and "Purva Shambharkar & Rohit Giri" each listed TWICE (once from each
  // partner's own form column, in reverse order). De-duplicated here so each real
  // pair only gets one booking.
  "Mixed Doubles": [
    ["Rajneesh Mehra","Aditi Goel"],["Ria David","Harshal Luniya"],["Purva Shambharkar","Rohit Giri"],
    ["Aman Bhatt","Pallavi Barman"],["Srishti Golchha","Shubham Dhabale"],
    ["Sarveshwari Umre","Dnyaneshwar Khonde"],["Vishakha Patil","Abhishek S"],
  ],
};

const FEES = {
  "Men's Singles": 200, "Women's Singles": 200,
  "Men's Doubles": 300, "Women's Doubles": 300,
  "Mixed Doubles": 300,
};

function slugEmail(name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, ".");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${slug}.${rand}@chalokhelne.local`;
}

function makeSportSelection(categoryName) {
  return {
    _id: new mongoose.Types.ObjectId(),
    sportId: TT_SPORT_ID,
    sportName: "Table Tennis",
    categoryName,
    fee: FEES[categoryName],
  };
}

function baseBookingFields(now) {
  return {
    coupon: { couponId: null, code: null, discountAmount: 0, usageId: null },
    transactionId: null,
    customFields: null,
    userId: null,
    userPhone: null,
    isGuestBooking: true,
    tournamentId: TOURNAMENT_ID,
    clubId: CLUB_ID,
    tournamentName: TOURNAMENT_NAME,
    tournamentType: "knockout + group stage",
    status: "confirmed",
    paymentStatus: "waived",
    paymentAmount: 0,
    paymentMethod: "cash",
    employeeId: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };
}

// Permissive schema — matches your existing document shape but doesn't enforce
// strict validation, so it won't conflict with your real app-level Booking model.
const bookingSchema = new mongoose.Schema({}, { strict: false, collection: 'bookings' });
const Booking = mongoose.model('BookingRaw', bookingSchema);

async function main() {
  await mongoose.connect(uri);
  console.log('Connected to', mongoose.connection.name);

  const now = new Date();
  const docs = [];

  // --- Singles: one booking per player ---------------------------------
  for (const [category, players] of Object.entries(SINGLES)) {
    for (const name of players) {
      const sportSelections = [makeSportSelection(category)];
      docs.push({
        ...baseBookingFields(now),
        team: { players: [], substitutes: [], roster: [] },
        userName: name,
        userEmail: slugEmail(name),
        sportSelections,
        totalFee: sportSelections.reduce((sum, s) => sum + s.fee, 0),
      });
    }
  }

  // --- Doubles / Mixed Doubles: one booking per PAIR --------------------
  for (const [category, pairs] of Object.entries(PAIRS)) {
    for (const [p1, p2] of pairs) {
      const sportSelections = [makeSportSelection(category)];
      const teamPlayers = [
        { name: p1, email: slugEmail(p1) },
        { name: p2, email: slugEmail(p2) },
      ];
      docs.push({
        ...baseBookingFields(now),
        team: { players: teamPlayers, substitutes: [], roster: [] },
        userName: `${p1} & ${p2}`, // primary contact / display name for the pair
        userEmail: teamPlayers[0].email, // booking contact defaults to player 1
        sportSelections,
        totalFee: sportSelections.reduce((sum, s) => sum + s.fee, 0),
      });
    }
  }

  const result = await Booking.insertMany(docs);
  const singlesCount = Object.values(SINGLES).flat().length;
  const pairsCount = Object.values(PAIRS).flat().length;
  console.log(`Inserted: ${result.length} documents (${singlesCount} singles + ${pairsCount} pair bookings)`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});