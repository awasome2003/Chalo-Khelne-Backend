const EquipmentListing = require("../Modal/EquipmentListing");
const User = require("../Modal/User");

// POST /api/donations/list — Create equipment listing
exports.createListing = async (req, res) => {
  try {
    const {
      sport,
      itemName,
      description,
      category,
      condition,
      originalPrice,
      askingPrice,
      images,
      sellerLevel,
      sellerContact,
    } = req.body;

    if (!sport || !itemName || !description || !category || !condition) {
      return res.status(400).json({
        success: false,
        message: "Sport, item name, description, category, and condition are required.",
      });
    }

    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const price = Number(askingPrice) || 0;

    const listing = new EquipmentListing({
      seller: userId,
      sellerName: user.name,
      sellerLevel: sellerLevel || "club",
      sport,
      itemName,
      description,
      category,
      condition,
      originalPrice: Number(originalPrice) || 0,
      askingPrice: price,
      isDonation: price === 0,
      images: images || [],
      sellerContact: sellerContact || user.mobile || "",
      status: "Active",
    });

    await listing.save();

    res.status(201).json({
      success: true,
      message: "Equipment listed successfully.",
      data: listing,
    });
  } catch (error) {
    console.error("Error creating listing:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create listing.",
      error: error.message,
    });
  }
};

// PUT /api/donations/list/:id — Update listing (seller only)
exports.updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const listing = await EquipmentListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    if (listing.seller.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    if (listing.status !== "Active") {
      return res.status(400).json({
        success: false,
        message: "Cannot update a listing that is not active.",
      });
    }

    const allowedFields = [
      "itemName", "description", "category", "condition", "sport",
      "originalPrice", "askingPrice", "images", "sellerLevel", "sellerContact",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        listing[field] = req.body[field];
      }
    });

    // Recalculate isDonation
    listing.isDonation = (Number(listing.askingPrice) || 0) === 0;

    await listing.save();

    res.json({
      success: true,
      message: "Listing updated successfully.",
      data: listing,
    });
  } catch (error) {
    console.error("Error updating listing:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update listing.",
      error: error.message,
    });
  }
};

// DELETE /api/donations/list/:id — Withdraw listing (seller only)
exports.withdrawListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const listing = await EquipmentListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    if (listing.seller.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    listing.status = "Withdrawn";
    await listing.save();

    res.json({
      success: true,
      message: "Listing withdrawn successfully.",
    });
  } catch (error) {
    console.error("Error withdrawing listing:", error);
    res.status(500).json({
      success: false,
      message: "Failed to withdraw listing.",
      error: error.message,
    });
  }
};

// GET /api/donations/listings — Browse all active listings (public)
exports.getListings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sport,
      category,
      condition,
      freeOnly,
      minPrice,
      maxPrice,
      sort = "newest",
      search,
    } = req.query;

    const filter = { status: "Active" };

    if (sport) filter.sport = { $regex: new RegExp(`^${sport}$`, "i") };
    if (category) filter.category = category;
    if (condition) filter.condition = condition;
    if (freeOnly === "true") filter.isDonation = true;
    if (minPrice) filter.askingPrice = { ...filter.askingPrice, $gte: Number(minPrice) };
    if (maxPrice) filter.askingPrice = { ...filter.askingPrice, $lte: Number(maxPrice) };
    if (search) {
      filter.$or = [
        { itemName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    let sortOption = { createdAt: -1 };
    if (sort === "price-low") sortOption = { askingPrice: 1 };
    if (sort === "price-high") sortOption = { askingPrice: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await EquipmentListing.countDocuments(filter);

    const listings = await EquipmentListing.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching listings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch listings.",
      error: error.message,
    });
  }
};

// GET /api/donations/listings/:id — Listing detail (public)
exports.getListingById = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await EquipmentListing.findById(id)
      .populate("seller", "name mobile sports")
      .populate("claimedBy", "name mobile")
      .lean();

    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    res.json({ success: true, data: listing });
  } catch (error) {
    console.error("Error fetching listing:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch listing.",
      error: error.message,
    });
  }
};

// GET /api/donations/my-listings — Seller's own listings
exports.getMyListings = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 20, status } = req.query;

    const filter = { seller: userId };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await EquipmentListing.countDocuments(filter);

    const listings = await EquipmentListing.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching my listings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your listings.",
      error: error.message,
    });
  }
};

// POST /api/donations/claim/:id — Claim / buy an item
exports.claimItem = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;
    const { paymentMethod, buyerContact } = req.body;

    const listing = await EquipmentListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    if (listing.status !== "Active") {
      return res.status(400).json({
        success: false,
        message: "This item is no longer available.",
      });
    }

    if (listing.seller.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot claim your own listing.",
      });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    listing.claimedBy = userId;
    listing.claimedByName = user.name;
    listing.claimedAt = new Date();
    listing.buyerContact = buyerContact || user.mobile || "";
    listing.status = "Reserved";

    if (listing.isDonation) {
      // Free donation — no payment needed, directly reserved
      listing.paymentStatus = null;
      listing.paymentMethod = null;
    } else {
      // Paid item — set payment method, await screenshot
      listing.paymentMethod = paymentMethod || "upi";
      listing.paymentStatus = "Pending";
    }

    await listing.save();

    res.json({
      success: true,
      message: listing.isDonation
        ? "Item claimed! Seller will be notified."
        : "Item reserved. Please upload payment proof.",
      data: listing,
    });
  } catch (error) {
    console.error("Error claiming item:", error);
    res.status(500).json({
      success: false,
      message: "Failed to claim item.",
      error: error.message,
    });
  }
};

// POST /api/donations/claim/:id/pay — Upload payment screenshot
exports.uploadPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;
    const { paymentScreenshot, transactionId, paymentMethod } = req.body;

    const listing = await EquipmentListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    if (!listing.claimedBy || listing.claimedBy.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You have not claimed this item.",
      });
    }

    if (listing.isDonation) {
      return res.status(400).json({
        success: false,
        message: "This is a free donation — no payment needed.",
      });
    }

    listing.paymentScreenshot = paymentScreenshot || listing.paymentScreenshot;
    listing.transactionId = transactionId || listing.transactionId;
    listing.paymentMethod = paymentMethod || listing.paymentMethod;
    listing.paymentStatus = "Pending";
    await listing.save();

    res.json({
      success: true,
      message: "Payment proof uploaded. Seller will verify.",
      data: listing,
    });
  } catch (error) {
    console.error("Error uploading payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload payment.",
      error: error.message,
    });
  }
};

// POST /api/donations/claim/:id/verify — Seller verifies payment & confirms sale
exports.verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id;
    const { action } = req.body; // "approve" or "reject"

    const listing = await EquipmentListing.findById(id);
    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found." });
    }

    if (listing.seller.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    if (listing.status !== "Reserved") {
      return res.status(400).json({
        success: false,
        message: "This listing is not in a claimable state.",
      });
    }

    if (action === "approve") {
      listing.paymentStatus = "Verified";
      listing.verifiedAt = new Date();
      listing.status = "Sold";

      await listing.save();

      res.json({
        success: true,
        message: "Payment verified. Item marked as sold.",
        data: listing,
      });
    } else if (action === "reject") {
      listing.paymentStatus = "Rejected";
      listing.claimedBy = null;
      listing.claimedByName = null;
      listing.claimedAt = null;
      listing.buyerContact = null;
      listing.paymentScreenshot = null;
      listing.transactionId = null;
      listing.paymentMethod = null;
      listing.status = "Active";

      await listing.save();

      res.json({
        success: true,
        message: "Payment rejected. Item is available again.",
        data: listing,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Action must be 'approve' or 'reject'.",
      });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment.",
      error: error.message,
    });
  }
};

// GET /api/donations/my-claims — Items I've claimed/bought
exports.getMyClaims = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const filter = { claimedBy: userId };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await EquipmentListing.countDocuments(filter);

    const claims = await EquipmentListing.find(filter)
      .sort({ claimedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: claims,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your claims.",
      error: error.message,
    });
  }
};
