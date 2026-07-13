/**
 * Per-sport event checklist + equipment templates.
 * Ported from the IONIX Event-OS prototype (domain-accurate).
 * Used to auto-seed an event's checklist (and, later, equipment log).
 */
const SPORT_TEMPLATES = {
  "Table Tennis": {
    checklist: [
      "Tables setup & inspection",
      "Net tension checked",
      "Referee tables & chairs positioned",
      "Draw creation verified",
      "QR Check-in desk ready",
      "Water & Energy drinks placed at player benches",
      "Live streaming cameras configured on Table 1",
      "Scoreboards / tablets tested",
    ],
    equipment: [
      { name: "ITTF Approved Tables", required: 8 },
      { name: "Nets & Clamps", required: 10 },
      { name: "3-Star Ball Boxes (Dozen)", required: 15 },
      { name: "Digital Score Tablets", required: 8 },
      { name: "Referee Scorecards", required: 12 },
    ],
  },
  Cricket: {
    checklist: [
      "Pitch rolling and line marking complete",
      "Boundary ropes laid down (65m radius)",
      "Commentary box & mic system online",
      "Match ball inventory verified",
      "Ground water drainage check",
      "Stumps and bails set up",
      "Sponsor boundary boards secured",
      "Live stream encoder set up",
    ],
    equipment: [
      { name: "Swaying Boundary Ropes (m)", required: 450 },
      { name: "Wooden Stumps & Bails Sets", required: 4 },
      { name: "Leather Match Balls (Red/White)", required: 24 },
      { name: "Digital Scoreboards", required: 2 },
      { name: "Umpire Counters & Shields", required: 6 },
    ],
  },
  Badminton: {
    checklist: [
      "Court line grip checking",
      "Net height set exactly at 1.55m",
      "Chair umpire high stand in position",
      "Shuttlecock tube boxes ready",
      "Court moisture mopping plan ready",
      "Speed testing of shuttlecocks complete",
    ],
    equipment: [
      { name: "Court Synthetic Mats", required: 4 },
      { name: "Post & Net Systems", required: 5 },
      { name: "Feather Shuttlecocks Tubes", required: 30 },
      { name: "Umpire Elevated Chairs", required: 4 },
      { name: "Mops & De-humidifiers", required: 4 },
    ],
  },
  Pickleball: {
    checklist: [
      "Pickleball net installation",
      "Kitchen line marking verified",
      "Portable net stands weighted",
      "Referee tablets assigned",
      "Paddle checklist ready",
    ],
    equipment: [
      { name: "Pickleball Portable Nets", required: 6 },
      { name: "Yellow Outdoor Balls", required: 100 },
      { name: "Court Squeegees", required: 2 },
      { name: "Scoring Tablets", required: 6 },
    ],
  },
  Carrom: {
    checklist: [
      "Carrom stand leveling verified",
      "Fine boric powder spread evenly",
      "Striker weights checklist complete",
      "Coin sets polished",
      "Stopwatches tested",
    ],
    equipment: [
      { name: "Championship Carrom Boards", required: 12 },
      { name: "Carrom Wooden Stands", required: 12 },
      { name: "Tournament Coin Sets", required: 12 },
      { name: "Boric Powder Bottles", required: 24 },
      { name: "Premium Strikers", required: 15 },
    ],
  },
  Football: {
    checklist: [
      "Goal post net anchoring checked",
      "Corner flags placed correctly",
      "Field line marking complete",
      "Match balls inflated to 0.8 bar",
      "Substitutions board ready",
    ],
    equipment: [
      { name: "Match Footballs (Size 5)", required: 12 },
      { name: "Corner Flags Set", required: 4 },
      { name: "Referee Electronic Whistles", required: 4 },
      { name: "Tactical Substitution Boards", required: 2 },
    ],
  },
  Foosball: {
    checklist: [
      "Foosball tables leveled & inspected",
      "Rods and handles greased",
      "Score markers reset",
      "Ball inventory verified",
      "Table surfaces cleaned",
    ],
    equipment: [
      { name: "Tournament Foosball Tables", required: 4 },
      { name: "Official Foosballs", required: 20 },
      { name: "Score Bead Markers", required: 8 },
    ],
  },
};

// Generic checklist for events whose sport has no template.
const GENERIC_CHECKLIST = [
  "Venue booking confirmed",
  "Registration desk & QR check-in ready",
  "Officials & referees assigned",
  "First-aid / medical point set up",
  "Scoreboards / scoring devices tested",
  "Sponsor branding placed",
];

module.exports = { SPORT_TEMPLATES, GENERIC_CHECKLIST };
