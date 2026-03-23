const EquipmentListing = require("../Modal/EquipmentListing");
const mongoose = require("mongoose");

// URL validation regex
const URL_REGEX = /^https?:\/\/([\w-]+\.)+[\w-]+(\/[\w-./?%&=]*)?$/i;

const vendorController = {
  /**
   * POST /api/equipment/vendor-link
   * Add or update vendor link on an equipment listing.
   * SuperAdmin only.
   */
  addVendorLink: async (req, res) => {
    try {
      const { equipment_id, vendor_link, vendor_name, price } = req.body;

      if (!equipment_id) {
        return res.status(400).json({ success: false, message: "equipment_id is required" });
      }
      if (!vendor_link) {
        return res.status(400).json({ success: false, message: "vendor_link is required" });
      }

      // Validate URL format
      if (!URL_REGEX.test(vendor_link)) {
        return res.status(400).json({
          success: false,
          message: "Invalid URL format. Must start with http:// or https://",
        });
      }

      // Basic sanitization — block javascript: and data: URIs
      const lowerLink = vendor_link.toLowerCase().trim();
      if (lowerLink.startsWith("javascript:") || lowerLink.startsWith("data:")) {
        return res.status(400).json({
          success: false,
          message: "Malicious URL detected",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(equipment_id)) {
        return res.status(400).json({ success: false, message: "Invalid equipment_id" });
      }

      const listing = await EquipmentListing.findById(equipment_id);
      if (!listing) {
        return res.status(404).json({ success: false, message: "Equipment listing not found" });
      }

      listing.vendorLink = vendor_link.trim();
      listing.vendorName = vendor_name?.trim() || null;
      listing.vendorPrice = price !== undefined && price !== null && price !== "" ? Number(price) : null;
      listing.vendorLinkAddedAt = new Date();
      listing.vendorClickCount = listing.vendorClickCount || 0;

      await listing.save();

      res.json({
        success: true,
        message: "Vendor link added successfully",
        listing: {
          _id: listing._id,
          itemName: listing.itemName,
          sport: listing.sport,
          category: listing.category,
          vendorLink: listing.vendorLink,
          vendorName: listing.vendorName,
          vendorPrice: listing.vendorPrice,
        },
      });
    } catch (err) {
      console.error("[VENDOR] Add link error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * DELETE /api/equipment/vendor-link/:id
   * Remove vendor link from an equipment listing.
   * SuperAdmin only.
   */
  removeVendorLink: async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid equipment ID" });
      }

      const listing = await EquipmentListing.findById(id);
      if (!listing) {
        return res.status(404).json({ success: false, message: "Equipment listing not found" });
      }

      listing.vendorLink = null;
      listing.vendorName = null;
      listing.vendorPrice = null;
      listing.vendorLinkAddedBy = null;
      listing.vendorLinkAddedAt = null;
      listing.vendorClickCount = 0;

      await listing.save();

      res.json({ success: true, message: "Vendor link removed" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * POST /api/equipment/vendor-click/:id
   * Track a click on a vendor link.
   * Public.
   */
  trackClick: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
      }

      const listing = await EquipmentListing.findByIdAndUpdate(
        id,
        { $inc: { vendorClickCount: 1 } },
        { new: true }
      );

      if (!listing) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      res.json({ success: true, vendorLink: listing.vendorLink, clicks: listing.vendorClickCount });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/equipment/vendor-links
   * List all equipment with vendor links attached (for SuperAdmin dashboard).
   */
  getLinkedEquipment: async (req, res) => {
    try {
      const { page = 1, limit = 20, sport, category, search } = req.query;
      const filter = { vendorLink: { $ne: null } };

      if (sport) filter.sport = sport;
      if (category) filter.category = category;
      if (search) {
        filter.$or = [
          { itemName: { $regex: search, $options: "i" } },
          { vendorName: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [listings, total] = await Promise.all([
        EquipmentListing.find(filter)
          .select("itemName sport category condition originalPrice askingPrice vendorLink vendorName vendorPrice vendorClickCount vendorLinkAddedAt status seller sellerName images")
          .sort({ vendorLinkAddedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        EquipmentListing.countDocuments(filter),
      ]);

      res.json({
        success: true,
        listings,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/equipment/all
   * List all equipment (for SuperAdmin to browse and attach links).
   */
  getAllEquipment: async (req, res) => {
    try {
      const { page = 1, limit = 20, sport, category, search, hasVendor } = req.query;
      const filter = {};

      if (sport) filter.sport = sport;
      if (category) filter.category = category;
      if (hasVendor === "true") filter.vendorLink = { $ne: null };
      if (hasVendor === "false") filter.vendorLink = null;
      if (search) {
        filter.$or = [
          { itemName: { $regex: search, $options: "i" } },
          { sellerName: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [listings, total] = await Promise.all([
        EquipmentListing.find(filter)
          .select("itemName sport category condition originalPrice askingPrice isDonation status seller sellerName sellerLevel images vendorLink vendorName vendorPrice vendorClickCount createdAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        EquipmentListing.countDocuments(filter),
      ]);

      // Stats
      const totalWithVendor = await EquipmentListing.countDocuments({ vendorLink: { $ne: null } });
      const totalClicks = await EquipmentListing.aggregate([
        { $match: { vendorLink: { $ne: null } } },
        { $group: { _id: null, total: { $sum: "$vendorClickCount" } } },
      ]);

      res.json({
        success: true,
        listings,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        stats: {
          totalEquipment: total,
          withVendorLinks: totalWithVendor,
          totalClicks: totalClicks[0]?.total || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /api/equipment/:id
   * Get single equipment with vendor info.
   * Public.
   */
  getEquipment: async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
      }

      const listing = await EquipmentListing.findById(id)
        .populate("seller", "name email profileImage")
        .lean();

      if (!listing) {
        return res.status(404).json({ success: false, message: "Equipment not found" });
      }

      res.json({ success: true, listing });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = vendorController;
