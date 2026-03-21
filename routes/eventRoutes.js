const express = require("express");
const Event = require("../Modal/EventModel"); // Ensure the path is correct
const router = express.Router();
const { uploadMiddleware, cleanupFile } = require("../middleware/uploads");

// Add new event with players
// router.post("/", uploadMiddleware.array("playerImages"), async (req, res) => {
//   const { title, date, isAllDay, time, court } = req.body;
//   const playerData = Array.isArray(req.body.players)
//     ? req.body.players
//     : JSON.parse(req.body.players || "[]");

//   try {
//     const players = playerData.map((player, index) => ({
//       name: player.name,
//       image: req.files[index]
//         ? `/uploads/events/${req.files[index].filename}`
//         : "",
//     }));

//     const newEvent = new Event({ title, date, isAllDay, time, court, players });
//     await newEvent.save();

//     res.status(201).json(newEvent);
//   } catch (error) {
//     // Clean up any uploaded files on error
//     if (req.files) {
//       await Promise.all(req.files.map((file) => cleanupFile(file.path)));
//     }
//     res.status(500).json({
//       message: "Error creating event with players",
//       error: error.message,
//     });
//   }
// });

// Get all events with players
router.get("/", async (req, res) => {
  try {
    const events = await Event.find();
    const updatedEvents = events.map((event) => ({
      ...event.toObject(),
      players: event.players.map((player) => ({
        ...player,
        image: player.image
          ? `${req.protocol}://${req.get("host")}/uploads/events/${
              player.image
            }`
          : "",
      })),
    }));
    res.status(200).json(updatedEvents);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching events", error: error.message });
  }
});

router.post("/:eventId/scores", async (req, res) => {
  const { eventId } = req.params;
  const { setOne, setTwo, setThree, winner } = req.body;

  try {
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Assuming that playerA is the first player and playerB is the second player in the players array
    const playerA = event.players[0]?.name;
    const playerB = event.players[1]?.name;

    // Create a new score object using the player names
    const newScore = {
      playerA,
      playerB,
      setOne,
      setTwo,
      setThree,
      winner,
    };

    // Update the score for the event
    event.score = newScore;
    await event.save();

    res.status(201).json(event);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error adding score", error: error.message });
  }
});

// Get scores for a specific event
router.get("/:eventId/scores", async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    res.status(200).json(event.score);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching scores", error: error.message });
  }
});

module.exports = router;
