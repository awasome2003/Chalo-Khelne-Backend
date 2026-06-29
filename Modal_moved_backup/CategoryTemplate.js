const mongoose = require("mongoose");

// Predefined age + gender category templates managed by SuperAdmin. Managers
// pick from this list when adding categories to a tournament — they cannot
// enter free-form age/gender values. The Tournament category sub-doc stores
// a snapshot of (label, minAge, maxAge, gender) so deactivating or editing
// a template later does not affect already-running tournaments.
const categoryTemplateSchema = new mongoose.Schema(
  {
    label:       { type: String, required: true, trim: true, unique: true },
    code:        { type: String, required: true, trim: true, unique: true, uppercase: true },
    minAge:      { type: Number, default: null },
    maxAge:      { type: Number, default: null },
    gender:      { type: String, enum: ["male", "female", "any"], default: "any" },
    description: { type: String, default: "" },
    isActive:    { type: Boolean, default: true },
    // Tracks which superadmin created the template — kept loose (no required:true)
    // so the seed script (which runs without an authenticated request) can omit it.
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "Superadmin", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CategoryTemplate", categoryTemplateSchema);
