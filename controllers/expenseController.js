const Expense = require("../Modal/Expense");
const ExpenseCategory = require("../Modal/ExpenseCategory");
const ExpensePayment = require("../Modal/ExpensePayment");
const mongoose = require("mongoose");

const expenseController = {
  // ========== CATEGORY ENDPOINTS ==========

  // Create expense category
  createCategory: async (req, res) => {
    try {
      const { name, description, icon } = req.body;
      const managerId = req.user._id || req.user.id;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Category name is required" });
      }

      const existing = await ExpenseCategory.findOne({
        name: name.trim(),
        createdBy: managerId,
      });
      if (existing) {
        return res.status(409).json({ success: false, message: "Category already exists" });
      }

      const category = await ExpenseCategory.create({
        name: name.trim(),
        description: description || "",
        icon: icon || "receipt",
        createdBy: managerId,
      });

      res.status(201).json({ success: true, message: "Category created", category });
    } catch (error) {
      console.error("[EXPENSE] Create category error:", error.message);
      res.status(500).json({ success: false, message: "Failed to create category", error: error.message });
    }
  },

  // Get all categories for this manager
  getCategories: async (req, res) => {
    try {
      const managerId = req.user._id || req.user.id;
      const categories = await ExpenseCategory.find({ createdBy: managerId, isActive: true })
        .sort({ name: 1 })
        .lean();

      res.status(200).json({ success: true, categories });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch categories", error: error.message });
    }
  },

  // Update category
  updateCategory: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const managerId = req.user._id || req.user.id;
      const { name, description, icon } = req.body;

      const category = await ExpenseCategory.findOne({ _id: categoryId, createdBy: managerId });
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      if (name) category.name = name.trim();
      if (description !== undefined) category.description = description;
      if (icon) category.icon = icon;

      await category.save();
      res.status(200).json({ success: true, message: "Category updated", category });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to update category", error: error.message });
    }
  },

  // Delete category (soft)
  deleteCategory: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const managerId = req.user._id || req.user.id;

      const category = await ExpenseCategory.findOne({ _id: categoryId, createdBy: managerId });
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      // Check if category is in use
      const inUse = await Expense.countDocuments({ category: categoryId, isDeleted: false });
      if (inUse > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete category. ${inUse} expense(s) are using it.`,
        });
      }

      category.isActive = false;
      await category.save();
      res.status(200).json({ success: true, message: "Category deleted" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to delete category", error: error.message });
    }
  },

  // ========== EXPENSE ENDPOINTS ==========

  // Add expense
  addExpense: async (req, res) => {
    try {
      const managerId = req.user._id || req.user.id;
      const { title, description, amount, category, eventType, eventId, eventName, vendor, expenseDate, notes } = req.body;

      if (!title || !amount || !category || !eventType || !expenseDate) {
        return res.status(400).json({
          success: false,
          message: "title, amount, category, eventType, and expenseDate are required",
        });
      }

      // Verify category belongs to this manager
      const cat = await ExpenseCategory.findOne({ _id: category, createdBy: managerId, isActive: true });
      if (!cat) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const expense = await Expense.create({
        title: title.trim(),
        description: description || "",
        amount,
        category,
        eventType,
        eventId: eventId || null,
        eventName: eventName || "",
        vendor: vendor || "",
        expenseDate: new Date(expenseDate),
        notes: notes || "",
        createdBy: managerId,
      });

      const populated = await Expense.findById(expense._id).populate("category", "name icon").lean();
      res.status(201).json({ success: true, message: "Expense added", expense: populated });
    } catch (error) {
      console.error("[EXPENSE] Add expense error:", error.message);
      res.status(500).json({ success: false, message: "Failed to add expense", error: error.message });
    }
  },

  // Update expense
  updateExpense: async (req, res) => {
    try {
      const { expenseId } = req.params;
      const managerId = req.user._id || req.user.id;

      const expense = await Expense.findOne({ _id: expenseId, createdBy: managerId, isDeleted: false });
      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      const { title, description, amount, category, eventType, eventId, eventName, vendor, expenseDate, notes } = req.body;

      if (title) expense.title = title.trim();
      if (description !== undefined) expense.description = description;
      if (amount !== undefined) expense.amount = amount;
      if (category) {
        const cat = await ExpenseCategory.findOne({ _id: category, createdBy: managerId, isActive: true });
        if (!cat) return res.status(404).json({ success: false, message: "Category not found" });
        expense.category = category;
      }
      if (eventType) expense.eventType = eventType;
      if (eventId !== undefined) expense.eventId = eventId;
      if (eventName !== undefined) expense.eventName = eventName;
      if (vendor !== undefined) expense.vendor = vendor;
      if (expenseDate) expense.expenseDate = new Date(expenseDate);
      if (notes !== undefined) expense.notes = notes;

      await expense.save();
      const populated = await Expense.findById(expense._id).populate("category", "name icon").lean();
      res.status(200).json({ success: true, message: "Expense updated", expense: populated });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to update expense", error: error.message });
    }
  },

  // Delete expense (soft)
  deleteExpense: async (req, res) => {
    try {
      const { expenseId } = req.params;
      const managerId = req.user._id || req.user.id;

      const expense = await Expense.findOne({ _id: expenseId, createdBy: managerId, isDeleted: false });
      if (!expense) {
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      expense.isDeleted = true;
      await expense.save();
      res.status(200).json({ success: true, message: "Expense deleted" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to delete expense", error: error.message });
    }
  },

  // List expenses (with filters + pagination)
  getExpenses: async (req, res) => {
    try {
      const managerId = req.user._id || req.user.id;
      const { page = 1, limit = 20, category, eventType, paymentStatus, search, startDate, endDate, sortBy = "expenseDate", sortOrder = "desc" } = req.query;

      const filter = { createdBy: managerId, isDeleted: false };

      if (category) filter.category = category;
      if (eventType) filter.eventType = eventType;
      if (paymentStatus) filter.paymentStatus = paymentStatus;
      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: "i" } },
          { vendor: { $regex: search, $options: "i" } },
          { eventName: { $regex: search, $options: "i" } },
        ];
      }
      if (startDate || endDate) {
        filter.expenseDate = {};
        if (startDate) filter.expenseDate.$gte = new Date(startDate);
        if (endDate) filter.expenseDate.$lte = new Date(endDate);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

      const [expenses, total] = await Promise.all([
        Expense.find(filter)
          .populate("category", "name icon")
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Expense.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        expenses,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch expenses", error: error.message });
    }
  },

  // Get expenses by event
  getExpensesByEvent: async (req, res) => {
    try {
      const { eventId } = req.params;
      const managerId = req.user._id || req.user.id;

      const expenses = await Expense.find({ eventId, createdBy: managerId, isDeleted: false })
        .populate("category", "name icon")
        .sort({ expenseDate: -1 })
        .lean();

      // Calculate summary
      const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalPaid = expenses.reduce((sum, e) => sum + e.totalPaid, 0);
      const byCategory = {};
      expenses.forEach((e) => {
        const catName = e.category?.name || "Uncategorized";
        if (!byCategory[catName]) byCategory[catName] = 0;
        byCategory[catName] += e.amount;
      });

      res.status(200).json({
        success: true,
        expenses,
        summary: { totalAmount, totalPaid, outstanding: totalAmount - totalPaid, byCategory, count: expenses.length },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch event expenses", error: error.message });
    }
  },

  // ========== PAYMENT ENDPOINTS ==========

  // Record payment for an expense
  recordPayment: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const managerId = req.user._id || req.user.id;
      const { expenseId, amount, paymentMode, paymentDate, transactionId, notes, status } = req.body;

      if (!expenseId || !amount || !paymentMode || !paymentDate) {
        return res.status(400).json({
          success: false,
          message: "expenseId, amount, paymentMode, and paymentDate are required",
        });
      }

      const expense = await Expense.findOne({ _id: expenseId, createdBy: managerId, isDeleted: false }).session(session);
      if (!expense) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Expense not found" });
      }

      // Create payment record
      const payment = await ExpensePayment.create(
        [
          {
            expense: expenseId,
            amount,
            paymentMode,
            paymentDate: new Date(paymentDate),
            transactionId: transactionId || "",
            notes: notes || "",
            status: status || "Paid",
            recordedBy: managerId,
          },
        ],
        { session }
      );

      // Update expense totalPaid and paymentStatus
      if (status !== "Failed") {
        expense.totalPaid += amount;
      }

      if (expense.totalPaid >= expense.amount) {
        expense.paymentStatus = "Paid";
      } else if (expense.totalPaid > 0) {
        expense.paymentStatus = "Partial";
      }

      await expense.save({ session });
      await session.commitTransaction();
      session.endSession();

      res.status(201).json({
        success: true,
        message: "Payment recorded",
        payment: payment[0],
        expenseStatus: expense.paymentStatus,
        totalPaid: expense.totalPaid,
        remaining: expense.amount - expense.totalPaid,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[EXPENSE] Record payment error:", error.message);
      res.status(500).json({ success: false, message: "Failed to record payment", error: error.message });
    }
  },

  // Get payments for an expense
  getExpensePayments: async (req, res) => {
    try {
      const { expenseId } = req.params;

      const payments = await ExpensePayment.find({ expense: expenseId })
        .sort({ paymentDate: -1 })
        .lean();

      res.status(200).json({ success: true, payments });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch payments", error: error.message });
    }
  },

  // ========== ANALYTICS ==========

  // Aggregate expense analytics
  getAnalytics: async (req, res) => {
    try {
      const managerId = req.user._id || req.user.id;
      const { startDate, endDate } = req.query;

      const filter = { createdBy: new mongoose.Types.ObjectId(managerId), isDeleted: false };
      if (startDate || endDate) {
        filter.expenseDate = {};
        if (startDate) filter.expenseDate.$gte = new Date(startDate);
        if (endDate) filter.expenseDate.$lte = new Date(endDate);
      }

      const [byCategory, byStatus, byEventType, totals] = await Promise.all([
        Expense.aggregate([
          { $match: filter },
          { $lookup: { from: "expensecategories", localField: "category", foreignField: "_id", as: "cat" } },
          { $unwind: "$cat" },
          { $group: { _id: "$cat.name", total: { $sum: "$amount" }, paid: { $sum: "$totalPaid" }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { _id: "$paymentStatus", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { _id: "$eventType", total: { $sum: "$amount" }, paid: { $sum: "$totalPaid" }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalPaid: { $sum: "$totalPaid" }, count: { $sum: 1 } } },
        ]),
      ]);

      res.status(200).json({
        success: true,
        analytics: {
          totals: totals[0] || { totalAmount: 0, totalPaid: 0, count: 0 },
          byCategory,
          byStatus,
          byEventType,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch analytics", error: error.message });
    }
  },
};

module.exports = expenseController;
