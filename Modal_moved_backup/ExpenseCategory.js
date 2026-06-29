const mongoose = require("mongoose");

const expenseCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
      default: "receipt",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubManager",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

expenseCategorySchema.index({ createdBy: 1 });
expenseCategorySchema.index({ name: 1, createdBy: 1 }, { unique: true });

module.exports = mongoose.model("ExpenseCategory", expenseCategorySchema);
