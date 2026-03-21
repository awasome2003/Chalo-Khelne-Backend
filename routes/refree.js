const express = require('express');
const router = express.Router();
const {
  getRequests,
  getRequestById,
  createRequest,
  updateRequestStatus
} = require('../controllers/refreerequestController');

// GET /api/requests?status=pending|accepted|rejected
router.get('/', getRequests);

// GET /api/requests/:id
router.get('/:id', getRequestById);

// POST /api/requests
router.post('/', createRequest);

// PUT /api/requests/:id/status
router.put('/:id/status', updateRequestStatus);

module.exports = router;
