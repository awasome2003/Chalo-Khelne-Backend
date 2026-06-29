const mongoose = require('mongoose');

// Define the Player Schema
const PlayerSchema = new mongoose.Schema({
  name: String,
  image: String,
});

// Define the Score Schema
const ScoreSchema = new mongoose.Schema({
  playerA: { type: String, required: true },
  playerB: { type: String, required: true },
  setOne: [Number],
  setTwo: [Number],
  setThree: [Number],
  winner: String,
}, { timestamps: true });

// Define the Event Schema and integrate Player and Score Schemas
const EventSchema = new mongoose.Schema({
  title: String,
  date: String,
  isAllDay: Boolean,
  time: String,
  eliminationType: String,
  tournamentType: String,
  court: String,
  players: [PlayerSchema],
  score: ScoreSchema,
});

// Export the Event model
const Event = mongoose.model('Event', EventSchema);
module.exports = Event;
