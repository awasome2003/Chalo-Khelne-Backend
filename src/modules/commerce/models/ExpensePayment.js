const mongoose = require("mongoose");

const expensePaymentSchema = new mongoose.Schema(
  {
    expense: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMode: {
      type: String,
      enum: ["Cash", "UPI", "Bank Transfer", "Cheque", "Card"],
      required: true,
    },
    paymentDate: {
      type: Date,
      required: true,
    },
    transactionId: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Paid",
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClubManager",
      required: true,
    },
  },
  { timestamps: true }
);

expensePaymentSchema.index({ expense: 1 });
expensePaymentSchema.index({ paymentDate: -1 });

module.exports = mongoose.model("ExpensePayment", expensePaymentSchema);
