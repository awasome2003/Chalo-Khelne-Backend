const mongoose = require("mongoose");

// A class / standard for a school (e.g. "Std 5", "IX") with its sections
// (e.g. ["A", "B", "C"]). Defined by the admin under Student Management and
// consumed by Schedule, Batch, roster, etc. as the canonical class/section list.
const schoolClassSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // school / organization admin
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true }, // "Std 5", "IX & X"
    sections: { type: [String], default: [] }, // ["A", "B"]
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One class name per club.
schoolClassSchema.index({ clubId: 1, name: 1 }, { unique: true });

const tenantScope = require("../../../../utils/tenantScope");
schoolClassSchema.plugin(tenantScope, { field: "clubId", enforce: true });

module.exports = mongoose.model("SchoolClass", schoolClassSchema);
