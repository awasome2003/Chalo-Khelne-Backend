/*
 * Seeds the Sports Library (encyclopedic content shown in the mobile app's
 * Sports Library module, managed by Super Admin).
 *
 * Run:  node scripts/seedSportLibrary.js
 *
 * Idempotent: upserts by `name`, so re-running refreshes content without dupes.
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const SportLibrary = require("../src/modules/catalog/models/SportLibrary");

const SPORTS = [
  {
    name: "Cricket",
    type: "Outdoor",
    description: "Bat & ball game played between two teams of eleven players.",
    iconName: "cricket",
    iconColor: "#FF9F1C",
    iconBgColor: "#FFF6E9",
    popularity: 95,
    eventsCount: 8,
    playersCount: "1250+",
    coaches: 24,
    turfs: 15,
    performance: "85%",
    order: 1,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Originating in south-east England in the 16th century, cricket became England's national sport in the 18th century and is now played worldwide, with strongholds in India, Australia, England, Pakistan and South Africa.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "ICC Cricket World Cup",
          "Indian Premier League (IPL)",
          "The Ashes (Test series)",
          "ICC T20 World Cup",
        ],
      },
      {
        title: "Playing Style",
        text: "Batting (aggressive or defensive), Bowling (fast pace or spin), and disciplined field positioning define a team's strategy.",
      },
    ],
    courtSections: [
      {
        title: "Field & Pitch Dimensions",
        highlightBlock: [
          "Pitch Length: 22 yards (20.12m)",
          "Pitch Width: 10 feet (3.05m)",
          "Boundary: 65 - 90 meters from center",
        ],
        text: "Played on a circular or oval grass field with a central pitch containing the stumps.",
      },
      {
        title: "Pitch Specifications",
        points: [
          "Two sets of wickets at each end of the pitch.",
          "Wickets are 28 inches (71.1cm) high.",
          "Bails placed across the top of the three stumps.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Willow wood cricket bat",
          "Leather cricket ball",
          "Protective pads, helmet, and gloves",
          "Spiked shoes for turf grip",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Practice keeping eye contact with the ball at release",
          "Learn a standard stance and grip on the handle",
          "Start hitting balls from a tee or slow underarm tosses",
          "Work on defensive strokes before power hits",
          "Join local net-practice groups",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Losing focus on the ball during the bowler's run-up",
          "Moving the front foot too late towards the pitch of the ball",
          "Gripping the bat too tight, reducing wrist play",
          "Backlift too high or crooked, leading to mistimed shots",
          "Playing across the line to straight deliveries",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Build explosive leg strength for running between wickets",
          "Work on shoulder and core stability for throwing and batting power",
          "Perform agility drills for quick fielding reactions",
          "Condition wrists and forearms regularly",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring Runs",
        points: [
          "Runs are scored by running between the wickets after hitting.",
          "Hitting the boundary along the ground scores 4 runs.",
          "Clearing the boundary on the full scores 6 runs.",
          "Extras come via wides, no-balls, byes, and leg-byes.",
        ],
      },
      {
        title: "Ways of Getting Out",
        points: [
          "Bowled: the ball hits the stumps and dislodges the bails.",
          "Caught: a fielder catches the ball off the bat before it bounces.",
          "LBW: the ball strikes the batter's leg in line with the stumps.",
          "Run Out / Stumped: bails dislodged while the batter is out of the crease.",
        ],
      },
    ],
  },
  {
    name: "Football",
    type: "Outdoor",
    description: "Team sport played between two sides of eleven with a spherical ball.",
    iconName: "soccer",
    iconColor: "#4EAD6A",
    iconBgColor: "#EBF7ED",
    popularity: 96,
    eventsCount: 12,
    playersCount: "2100+",
    coaches: 18,
    turfs: 22,
    performance: "90%",
    order: 2,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Modern football was codified in England in 1863, deriving from older ball-kicking games. It is today the world's most watched and played sport.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "FIFA World Cup",
          "UEFA Champions League",
          "English Premier League (EPL)",
          "Copa America",
        ],
      },
      {
        title: "Playing Style",
        text: "Tiki-taka (possession-based), counter-attacking, and gegenpressing (high press) are common tactical identities.",
      },
    ],
    courtSections: [
      {
        title: "Field Dimensions",
        highlightBlock: [
          "Field Length: 90 - 120m",
          "Field Width: 45 - 90m",
          "Goal: 7.32m wide by 2.44m high",
        ],
        text: "Played on a rectangular grass or turf pitch with goals at both ends.",
      },
      {
        title: "Pitch Markings",
        points: [
          "Touchlines (sides) and goal lines (ends).",
          "Halfway line with a center circle of 9.15m radius.",
          "Penalty box (16.5m from goal line) and 6-yard box.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Standard Size 5 football",
          "Shin guards (mandatory)",
          "Studded boots (cleats)",
          "Team jersey, shorts and socks",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Master inside-foot passing and receiving",
          "Learn to dribble keeping the ball close to both feet",
          "Practice shooting with the laces for power and accuracy",
          "Understand positional roles (Defend, Midfield, Attack)",
          "Play small-sided games (5v5) to increase touches",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Staring at the ball instead of scanning the field",
          "Chasing the ball instead of holding your tactical shape",
          "Using only your dominant foot",
          "High-risk tackling that gives away fouls",
          "Failing to communicate during transitions",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Use HIIT training to build match-day stamina",
          "Strengthen legs and glutes for explosive sprints",
          "Train core agility to change direction quickly",
          "Stretch hamstrings to prevent cramps",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring",
        points: [
          "A goal counts when the whole ball crosses the goal line between the posts and under the bar.",
          "Each goal is worth 1 point.",
          "The team with the most goals at full time wins.",
        ],
      },
      {
        title: "Match Format",
        points: [
          "Two 45-minute halves (90 minutes total) plus stoppage time.",
          "11 players per side including a goalkeeper.",
          "Up to 5 substitutions in most official competitions.",
        ],
      },
    ],
  },
  {
    name: "Badminton",
    type: "Indoor",
    description: "Fast racket sport played with a shuttlecock across a high net.",
    iconName: "badminton",
    iconColor: "#2F80ED",
    iconBgColor: "#EEF4FC",
    popularity: 85,
    eventsCount: 5,
    playersCount: "850+",
    coaches: 12,
    turfs: 8,
    performance: "78%",
    order: 3,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Developed from the game of battledore and shuttlecock; the modern rules took shape in British India (Poona) in the 1860s and were formalized in England.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "Olympic Games",
          "BWF World Championships",
          "All England Open",
          "Thomas Cup & Uber Cup",
        ],
      },
      { title: "Playing Style", text: "Singles, Doubles, and Mixed Doubles, each with distinct positioning and pace." },
    ],
    courtSections: [
      {
        title: "Court Dimensions",
        highlightBlock: [
          "Length: 13.4m (44 ft)",
          "Width (Doubles): 6.1m (20 ft)",
          "Width (Singles): 5.18m (17 ft)",
        ],
        text: "A rectangular court divided by a net across the center.",
      },
      {
        title: "Net Specifications",
        points: [
          "Net height: 1.55m (5 ft 1 in) at the edges",
          "Net height: 1.524m (5 ft) at the center",
          "Net stretches across the full width of the court",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Lightweight racket (~85g)",
          "Shuttlecock (feather or nylon)",
          "Non-marking court shoes",
          "Comfortable sportswear",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Learn the basic grip and ready stance",
          "Practice forehand and backhand clears",
          "Master a legal low and high serve",
          "Work on footwork and court coverage",
          "Join beginner training sessions",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Using only the wrist instead of full arm and rotation",
          "Poor footwork and recovery to the center",
          "Gripping the racket too tightly",
          "Not watching the shuttle onto the strings",
          "Standing flat-footed between shots",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Build stamina with interval cardio",
          "Strengthen legs for fast lunges and jumps",
          "Improve wrist and forearm flexibility",
          "Practice agility ladder drills",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring System",
        points: [
          "Rally scoring to 21 points.",
          "Must win by 2 points (capped at 30).",
          "Best of 3 games wins the match.",
          "A point is scored on every rally regardless of server.",
        ],
      },
      {
        title: "Match Format",
        points: [
          "Singles: 1 vs 1.",
          "Doubles: 2 vs 2.",
          "Mixed Doubles: one male and one female per side.",
          "Players change ends after each game.",
        ],
      },
      {
        title: "Fouls & Faults",
        points: [
          "Touching the net with body or racket is a fault.",
          "A double hit is a fault.",
          "Service above the waist or with delayed motion is a fault.",
          "Shuttle landing outside the lines is out.",
        ],
      },
    ],
  },
  {
    name: "Table Tennis",
    type: "Indoor",
    description: "Fast-paced racket sport played across a table with a light ball.",
    iconName: "table-tennis",
    iconColor: "#EB5757",
    iconBgColor: "#FDF0F0",
    popularity: 78,
    eventsCount: 4,
    playersCount: "650+",
    coaches: 10,
    turfs: 6,
    performance: "82%",
    order: 4,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Started in Victorian England as an after-dinner game. By the 1950s the modern sponge paddle transformed it, and it became an Olympic sport in 1988.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "Olympic Games",
          "ITTF World Championships",
          "Table Tennis World Cup",
          "WTT Grand Smashes",
        ],
      },
      {
        title: "Playing Style",
        text: "Penhold vs shakehand grips; offensive loopers vs defensive choppers.",
      },
    ],
    courtSections: [
      {
        title: "Table Dimensions",
        highlightBlock: [
          "Table Length: 2.74m (9.0 ft)",
          "Table Width: 1.525m (5.0 ft)",
          "Height: 76cm (2.5 ft) above the floor",
        ],
        text: "Played on a dark, matte rectangular table split by a central net.",
      },
      {
        title: "Net Specifications",
        points: [
          "Net height: 15.25cm (6.0 in) across the center.",
          "Net extends 15.25cm beyond each table edge.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Rubber-surfaced paddle (racket)",
          "40mm+ plastic ball",
          "Indoor shoes with rubber soles",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Choose a neutral shakehand or penhold grip",
          "Practice the forehand drive stroke mechanics",
          "Learn to read spin (topspin vs backspin)",
          "Work on side-to-side shuffle footwork",
          "Rally with varied paddle surfaces to adapt",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Swinging too hard instead of brushing the ball",
          "Standing too close to the table on deep returns",
          "Holding the handle too stiffly, killing spin",
          "Not watching the opponent's contact point",
          "Reaching for the ball instead of moving the feet",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Train quick footwork and lateral speed",
          "Build core stability for rotational power",
          "Improve wrist mobility and coordination",
          "Do reaction-time visual drills",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring System",
        points: [
          "A game is won by the first to 11 points.",
          "Must win by at least 2 points.",
          "Service alternates every 2 points.",
        ],
      },
      {
        title: "Match Format",
        points: [
          "Singles (1 vs 1) or Doubles (2 vs 2).",
          "Matches are best of 5 or best of 7 games.",
          "In doubles, partners must alternate hits.",
        ],
      },
    ],
  },
  {
    name: "Basketball",
    type: "Outdoor",
    description: "Team sport where players score by shooting a ball through a hoop.",
    iconName: "basketball",
    iconColor: "#E28743",
    iconBgColor: "#FAF0E8",
    popularity: 82,
    eventsCount: 6,
    playersCount: "850+",
    coaches: 16,
    turfs: 10,
    performance: "85%",
    order: 5,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Invented by Dr. James Naismith in Springfield, Massachusetts in 1891 as a less injury-prone indoor game. It is now one of the world's most popular sports.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "NBA Finals",
          "FIBA Basketball World Cup",
          "NCAA March Madness",
          "EuroLeague",
        ],
      },
      {
        title: "Playing Style",
        text: "Fast-break, half-court offense, pick-and-roll, and zone or man-to-man defense.",
      },
    ],
    courtSections: [
      {
        title: "Court Dimensions",
        highlightBlock: [
          "Court Length: 28m (91.8 ft)",
          "Court Width: 15m (49.2 ft)",
          "Hoop Height: 3.05m (10 ft)",
        ],
        text: "Played on a rectangular wooden or composite hard court.",
      },
      {
        title: "Court Markings",
        points: [
          "Three-point line: 6.75m from the basket (FIBA).",
          "Free-throw line: 4.60m from the backboard.",
          "Center circle and restricted key area.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Basketball (Size 7 men, Size 6 women)",
          "Shoes with ankle support and traction",
          "Team jerseys",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Practice layups off the correct foot using the backboard",
          "Learn the triple-threat stance",
          "Master chest and bounce passes",
          "Dribble without looking down at the ball",
          "Learn the 5 positions (PG, SG, SF, PF, C)",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Dribbling with palms instead of fingertips",
          "Reaching on defense, giving away fouls",
          "Looking at the floor while running",
          "Jumping to pass without an open receiver",
          "Failing to box out on rebounds",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Develop vertical leap with plyometrics",
          "Build full-body strength for defensive positioning",
          "Train sprint intervals for transitions",
          "Do ankle and knee stabilization drills",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring System",
        points: [
          "Baskets inside the arc score 2 points.",
          "Baskets beyond the 3-point line score 3 points.",
          "Each free throw scores 1 point.",
        ],
      },
      {
        title: "Match Format",
        points: [
          "5 players per side on court.",
          "4 quarters of 10 minutes (FIBA) or 12 minutes (NBA).",
          "24-second shot clock to attempt a shot that hits the rim.",
        ],
      },
    ],
  },
  {
    name: "Tennis",
    type: "Outdoor",
    description: "Racket sport played on a rectangular court divided by a net.",
    iconName: "tennis",
    iconColor: "#008080",
    iconBgColor: "#E0F2F1",
    popularity: 75,
    eventsCount: 3,
    playersCount: "580+",
    coaches: 14,
    turfs: 9,
    performance: "72%",
    order: 6,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Evolved from the 12th-century French game jeu de paume, with modern lawn tennis formalized in Birmingham, England in 1872.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "Wimbledon",
          "US Open",
          "Roland Garros (French Open)",
          "Australian Open",
        ],
      },
      {
        title: "Playing Style",
        text: "Serve-and-volley, baseline play, and all-court defensive strategy.",
      },
    ],
    courtSections: [
      {
        title: "Court Dimensions",
        highlightBlock: [
          "Length: 23.77m (78 ft)",
          "Width (Doubles): 10.97m (36 ft)",
          "Width (Singles): 8.23m (27 ft)",
        ],
        text: "Played on grass, clay, or acrylic hard courts with a central net.",
      },
      {
        title: "Net Specifications",
        points: [
          "Net height: 0.914m (3 ft) at the center.",
          "Post height: 1.07m (3.5 ft) at the edges.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Strung tennis racket",
          "Pressurized tennis balls",
          "Court shoes suited to the surface",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Learn Continental and Eastern grips",
          "Rally forehands consistently over the net",
          "Develop a repeatable service toss",
          "Time your split-step before each shot",
          "Prioritize consistency over power early on",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Flat wrists instead of a low-to-high brush",
          "Tense shoulders preventing a clean swing",
          "Tossing the serve out of the strike zone",
          "Standing flat-footed on incoming balls",
          "Camping on the baseline against deep shots",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Build single-leg strength for lateral push-off",
          "Train core rotation for groundstroke power",
          "Practice side-shuffle and cross-over steps",
          "Condition shoulders and wrists to avoid tennis elbow",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring System",
        points: [
          "Points run Love (0) → 15 → 30 → 40 → Game.",
          "Deuce at 40-40: win two consecutive points to take the game.",
          "A set is won at 6 games with a 2-game lead.",
        ],
      },
      {
        title: "Match Format",
        points: [
          "Singles or Doubles.",
          "Best of 3 sets (common) or best of 5 sets.",
          "A tiebreak is played at 6-6 in a set.",
        ],
      },
    ],
  },
  {
    name: "Volleyball",
    type: "Outdoor",
    description: "Team sport where two sides rally a ball over a high net.",
    iconName: "volleyball",
    iconColor: "#7D3C98",
    iconBgColor: "#F4ECF7",
    popularity: 70,
    eventsCount: 2,
    playersCount: "420+",
    coaches: 8,
    turfs: 5,
    performance: "68%",
    order: 7,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Created by William G. Morgan in Holyoke, Massachusetts in 1895, blending elements of basketball, tennis, handball, and baseball.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "Olympic Games",
          "FIVB World Championship",
          "Volleyball Nations League (VNL)",
          "CEV Champions League",
        ],
      },
      {
        title: "Playing Style",
        text: "Attack (spike), set (fingertip control), pass (forearm bump), and block.",
      },
    ],
    courtSections: [
      {
        title: "Court Dimensions",
        highlightBlock: [
          "Court Length: 18m (59 ft)",
          "Court Width: 9m (29.5 ft)",
          "Net Height: 2.43m (Men), 2.24m (Women)",
        ],
        text: "Divided into two 9m x 9m halves by a vertical net.",
      },
      {
        title: "Court Boundaries",
        points: [
          "Attack line 3m from the net separates front and back zones.",
          "Full court boundary measures 9m x 18m.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Indoor leather volleyball",
          "Knee pads for floor defense",
          "Rubber-sole indoor court shoes",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Master the forearm pass (bump) platform",
          "Learn the overhead hand position for setting",
          "Practice an underhand serve for consistency",
          "Learn the three-step spike approach",
          "Call for the ball to coordinate plays",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Bending elbows during the forearm pass",
          "Double-contact on sets with uneven hands",
          "Watching the ball instead of covering the block",
          "Swinging arms up during the serve toss",
          "Jumping too late or touching the net",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Develop explosive leg power for spikes and blocks",
          "Strengthen rotator cuffs for heavy swings",
          "Train lateral movement speed",
          "Condition wrists and fingers for blocking",
        ],
      },
    ],
    rules: [
      {
        title: "Scoring System",
        points: [
          "Rally scoring: a point is scored on every serve.",
          "Sets are played to 25 points (win by 2).",
          "A match is won by taking 3 of 5 sets (5th set to 15).",
        ],
      },
      {
        title: "Match Format",
        points: [
          "6 players per side on court.",
          "Players rotate clockwise after winning back the serve.",
          "Maximum 3 touches per side before returning the ball.",
        ],
      },
    ],
  },
  {
    name: "Athletics",
    type: "Outdoor",
    description: "Track & field sports covering running, jumping, and throwing.",
    iconName: "run",
    iconColor: "#566573",
    iconBgColor: "#EAECEE",
    popularity: 65,
    eventsCount: 4,
    playersCount: "780+",
    coaches: 12,
    turfs: 4,
    performance: "60%",
    order: 8,
    aboutSections: [
      {
        title: "Origin & History",
        text: "Rooted in the ancient Greek games dating back to 776 BC, athletics was codified into modern track-and-field events in 19th-century schools and universities.",
      },
      {
        title: "Popular Tournaments",
        points: [
          "Olympic Games",
          "World Athletics Championships",
          "Diamond League",
          "World Indoor Championships",
        ],
      },
      {
        title: "Disciplines",
        text: "Sprints, middle- and long-distance runs, hurdles, jumps (long/high/triple), and throws (shot put, discus, javelin).",
      },
    ],
    courtSections: [
      {
        title: "Track Dimensions",
        highlightBlock: [
          "Track: 400m standard oval",
          "Lane Width: 1.22m",
          "Relay Exchange Zone: 20m",
        ],
        text: "Contested on a standard outdoor track with a central field area.",
      },
      {
        title: "Field Specifications",
        points: [
          "Long/triple jump take-off board is 20cm wide.",
          "Throwing circles: shot put 2.135m, discus 2.50m diameter.",
        ],
      },
      {
        title: "Equipment Needed",
        points: [
          "Spiked running shoes",
          "Relay baton",
          "Implements: javelin, shot put, or discus (weight by category)",
        ],
      },
    ],
    tipsSections: [
      {
        title: "How to Start",
        type: "numbered",
        points: [
          "Pick a discipline (sprints, distance, jumps, or throws)",
          "Learn the block-start stance for sprints",
          "Build an aerobic base with steady runs",
          "Drive the arms from the shoulders",
          "Work on posture and high-knee mechanics",
        ],
      },
      {
        title: "Common Mistakes",
        type: "cross",
        points: [
          "Over-striding, which brakes momentum",
          "Clenching fists and tensing the jaw",
          "False-starting before the gun",
          "Drifting outside the lane on curves",
          "Wrong take-off foot in jump events",
        ],
      },
      {
        title: "Fitness Tips",
        type: "bullet",
        points: [
          "Add plyometric bounds for sprint power",
          "Build core strength to hold posture",
          "Stretch dynamically every session",
          "Train breathing rhythm for distance",
        ],
      },
    ],
    rules: [
      {
        title: "Track Rules",
        points: [
          "A false start results in disqualification.",
          "Runners in sprints must stay inside their lane.",
          "Relay batons must be passed within the 20m changeover zone.",
        ],
      },
      {
        title: "Field Rules",
        points: [
          "Jumping beyond the take-off board is a foul.",
          "Throws must land within the marked sector to count.",
        ],
      },
    ],
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    let created = 0;
    let updated = 0;
    for (const sport of SPORTS) {
      const slug = sport.name.toLowerCase().replace(/\s+/g, "-");
      const existing = await SportLibrary.findOne({ name: sport.name });
      if (existing) {
        await SportLibrary.updateOne(
          { _id: existing._id },
          { $set: { ...sport, slug } }
        );
        updated++;
        console.log(`  updated  ${sport.name}`);
      } else {
        await SportLibrary.create({ ...sport, slug });
        created++;
        console.log(`  created  ${sport.name}`);
      }
    }

    console.log(`\nDone. ${created} created, ${updated} updated.`);
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

seed();
