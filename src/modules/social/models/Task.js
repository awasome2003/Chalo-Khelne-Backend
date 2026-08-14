const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Manager',
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  time: {
    type: Date,
    default: Date.now,
  },
  read: {
    type: Boolean,
    default: false,
  },
});

const Notification = mongoose.model('Notification', NotificationSchema);


// ── Indexes (§7.3 — this model declared none) ──────────────────────────
// unread task badge
NotificationSchema.index({ managerId: 1, read: 1 });

module.exports = Notification;
