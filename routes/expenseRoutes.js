const express = require("express");
const router = express.Router();
const expenseController = require("../controllers/expenseController");
const { managerAuth } = require("../middleware/authMiddleware");

// All expense routes require manager authentication
router.use(managerAuth);

// ===== Category Routes =====
router.post("/categories/create", expenseController.createCategory);
router.get("/categories", expenseController.getCategories);
router.put("/categories/:categoryId", expenseController.updateCategory);
router.delete("/categories/:categoryId", expenseController.deleteCategory);

// ===== Expense Routes =====
router.post("/add", expenseController.addExpense);
router.put("/update/:expenseId", expenseController.updateExpense);
router.delete("/delete/:expenseId", expenseController.deleteExpense);
router.get("/", expenseController.getExpenses);
router.get("/analytics", expenseController.getAnalytics);
router.get("/event/:eventId", expenseController.getExpensesByEvent);

// ===== Payment Routes =====
router.post("/payment", expenseController.recordPayment);
router.get("/payments/:expenseId", expenseController.getExpensePayments);

module.exports = router;
