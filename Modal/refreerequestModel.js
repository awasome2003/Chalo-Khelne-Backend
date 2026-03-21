const mongoose = require('mongoose');

const refrequestSchema = new mongoose.Schema({
  club: { type: String, required: true },
  positionType: { type: String, required: true },
  game: { type: String, required: true },
  matchFee: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  date: { type: String, required: true },
  time: { type: String, required: true },
  venue: { type: String, required: true },
  duration: { type: String, required: true },
  contact: { type: String, required: true },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.models.RefereeRequest || 
                 mongoose.model('RefereeRequest', refrequestSchema);