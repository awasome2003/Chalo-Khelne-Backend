// models/KnockoutMatch.js

const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  rank: {
    type: Number,
    default: null
  },
  score: {
    type: Number,
    default: 0
  },
  image: {
    type: String,
    default: null
  }
});

const knockoutMatchSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Tournament'
  },
  title: {
    type: String,
    required: true
  },
  matchStage: {
    type: String,
    enum: ['knockout', 'quarterfinal', 'semifinal', 'final'],
    default: 'knockout'
  },
  date: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  selectedCourt: {
    type: String,
    required: true
  },
  teams: {
    type: [teamSchema],
    validate: {
      validator: function(teams) {
        return teams.length === 2;
      },
      message: 'A knockout match must have exactly two teams'
    }
  },
  winner: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'SCHEDULED'
  },
  scores: [{
    set: Number,
    team1Score: Number,
    team2Score: Number
  }],
  reminder: {
    isEnabled: {
      type: Boolean,
      default: true
    },
    reminderTime: {
      type: Date,
      required: function() {
        return this.reminder.isEnabled;
      }
    }
  },
  matchNumber: {
    type: Number,
    required: true
  },
  nextMatchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnockoutMatch',
    default: null
  },
  previousMatchIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnockoutMatch'
  }],
  roundNumber: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Middleware to auto-increment matchNumber within a tournament
knockoutMatchSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      const lastMatch = await this.constructor.findOne({
        tournamentId: this.tournamentId
      }).sort({ matchNumber: -1 });
      
      this.matchNumber = lastMatch ? lastMatch.matchNumber + 1 : 1;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Method to update match status based on scores
knockoutMatchSchema.methods.updateMatchStatus = function() {
  if (this.winner) {
    this.status = 'completed';
  } else if (this.scores && this.scores.length > 0) {
    this.status = 'in_progress';
  }
};

// Static method to get matches by stage
knockoutMatchSchema.statics.getMatchesByStage = function(tournamentId, stage) {
  return this.find({
    tournamentId,
    matchStage: stage
  }).sort({ matchNumber: 1 });
};

// Method to advance winner to next match
knockoutMatchSchema.methods.advanceWinner = async function() {
  if (!this.winner || !this.nextMatchId) return;

  const nextMatch = await this.constructor.findById(this.nextMatchId);
  if (!nextMatch) return;

  // Determine which position to place the winner (first or second team)
  const position = nextMatch.previousMatchIds.indexOf(this._id);
  if (position === -1) return;

  // Update the team in the next match
  const winningTeam = this.teams.find(team => team.name === this.winner);
  if (!winningTeam) return;

  nextMatch.teams[position] = {
    name: winningTeam.name,
    playerId: winningTeam.playerId,
    rank: winningTeam.rank,
    score: 0
  };

  await nextMatch.save();
};

// Middleware to automatically advance winner after save
knockoutMatchSchema.post('save', async function(doc) {
  if (doc.winner) {
    await doc.advanceWinner();
  }
});

const KnockoutMatch = mongoose.model('Semifinals', knockoutMatchSchema);

module.exports = KnockoutMatch;