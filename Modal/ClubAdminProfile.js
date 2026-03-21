const mongoose = require("mongoose");

// Define a schema for contact persons
const ContactSchema = new mongoose.Schema({
  contactPersonName: {
    type: String,
    required: true,
  },
  designation: {
    type: String,
    required: true,
  },
  contactNumber: {
    type: String,
    required: true,
  },
});

// Main Club Admin schema
const ClubAdminProfileSchema = new mongoose.Schema(
  {
    // clubID: {
    //   type: String,
    //   required: true,
    // },
    // clubName: {
    //   type: String,
    //   required: true,
    // },
    address: {
      type: String,
      required: true,
    },
    area: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
    // registrationID: {
    //   type: String,
    //   required: true,
    // },
    typeOfRegistration: {
      type: String, // "Private" or "Govt"
      enum: ["Private", "Govt"],
      required: true,
    },
    registrationDate: {
      type: Date,
      required: true,
    },
    sports: {
      type: String,
      required: true,
    },
    noOfPlayers: {
      type: Number,
      required: true,
    },
    timeToOpen: {
      type: String,
      required: true,
    },
    timeToClose: {
      type: String,
      required: true,
    },
    contacts: {
      type: [ContactSchema],
      required: true,
    },
    clubPhotosID: {
      type: String, // You can use array of strings if multiple photos
    },
    clubVideosID: {
      type: String, // You can use array of strings if multiple videos
    },
    addressLink: {
      type: String, // Google Maps or other map link
    },
    validityDate: {
      type: Date,
    },
    locations: {
      type: String,
      required: true,
    },
    authorizations: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

const ClubAdmin = mongoose.model("ClubAdminProfile", ClubAdminProfileSchema);

module.exports = ClubAdmin;
