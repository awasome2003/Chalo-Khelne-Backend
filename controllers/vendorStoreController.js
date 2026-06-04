/**
 * Vendor STORE workflow — the QC/middleman pipeline.
 *
 * Player uploads a product (mobile Sell → EquipmentListing, vendorStatus
 * "pending_review") → platform vendor reviews it → Accept (with an offer:
 * purchase price, repair, pickup date) or Reject → seller is notified →
 * seller accepts/declines the offer → vendor picks it up → vendor sets a
 * resale price and publishes → it becomes "listed" and shows in the store.
 *
 * Phase 1: status workflow only (no money movement). Routes are gated to the
 * platform vendor (see routes/vendorStoreRoutes.js); the seller offer-response
 * route is owner-checked here.
 */
const mongoose = require("mongoose");
const EquipmentListing = require("../Modal/EquipmentListing");
const VendorProfile = require("../Modal/VendorProfile");
const { notifyPlayer } = require("../utils/playerNotify");

function badId(res) {
  return res.status(400).json({ success: false, message: "Invalid product id" });
}

async function paginate(filter, req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const [data, total] = await Promise.all([
    EquipmentListing.find(filter)
      .populate("seller", "name email mobile")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EquipmentListing.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

// ── Platform vendor: incoming product queue (pending review) ──
exports.getIncoming = async (req, res) => {
  try {
    const filter = { vendorStatus: "pending_review" };
    if (req.query.sport) filter.sport = req.query.sport;
    if (req.query.search) filter.itemName = { $regex: String(req.query.search).trim(), $options: "i" };
    const result = await paginate(filter, req);
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("[VSTORE_INCOMING]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: products this vendor handles (acquisitions/inventory) ──
exports.getMyProducts = async (req, res) => {
  try {
    const filter = { handledByVendor: req.vendorProfile._id };
    if (req.query.status) filter.vendorStatus = req.query.status; // e.g. ready_for_pickup, acquired, listed, sold
    const result = await paginate(filter, req);
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("[VSTORE_MY]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: single product detail ──
exports.getProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const product = await EquipmentListing.findById(req.params.id)
      .populate("seller", "name email mobile")
      .lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(200).json({ success: true, data: product });
  } catch (e) {
    console.error("[VSTORE_GET]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: ACCEPT a product (make an offer) ──
exports.acceptProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const { purchasePrice, repairNeeded, repairCost, repairDescription, pickupDate } = req.body;

    if (purchasePrice == null || Number(purchasePrice) < 0) {
      return res.status(400).json({ success: false, message: "A valid suggested purchase price is required" });
    }
    if (!pickupDate) {
      return res.status(400).json({ success: false, message: "Pickup/collection date is required" });
    }

    const product = await EquipmentListing.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.vendorStatus !== "pending_review") {
      return res.status(409).json({ success: false, message: `Cannot accept a product that is "${product.vendorStatus}"` });
    }

    product.vendorStatus = "offer_made";
    product.handledByVendor = req.vendorProfile._id;
    product.sellerOfferResponse = "pending";
    product.sellerRespondedAt = null;
    product.vendorOffer = {
      purchasePrice: Number(purchasePrice),
      repairNeeded: !!repairNeeded,
      repairCost: repairCost != null ? Number(repairCost) : 0,
      repairDescription: repairDescription || "",
      pickupDate: new Date(pickupDate),
      offeredAt: new Date(),
    };
    await product.save();

    // Notify the seller of the offer.
    if (product.seller) {
      try {
        await notifyPlayer(req.app, product.seller, {
          type: "vendor_offer",
          title: "Offer received for your product",
          message: `${req.vendorProfile.businessName} offered ₹${Number(purchasePrice)} for "${product.itemName}". Pickup on ${new Date(pickupDate).toLocaleDateString("en-IN")}.`,
          data: { listingId: String(product._id) },
        });
      } catch (_) {}
    }

    return res.status(200).json({ success: true, message: "Offer sent to the seller", data: product });
  } catch (e) {
    console.error("[VSTORE_ACCEPT]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: REJECT a product ──
exports.rejectProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const product = await EquipmentListing.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (!["pending_review", "offer_made"].includes(product.vendorStatus)) {
      return res.status(409).json({ success: false, message: `Cannot reject a product that is "${product.vendorStatus}"` });
    }

    product.vendorStatus = "rejected";
    product.handledByVendor = req.vendorProfile._id;
    product.rejectionReason = req.body.reason || "";
    await product.save();

    if (product.seller) {
      try {
        await notifyPlayer(req.app, product.seller, {
          type: "vendor_rejected",
          title: "Product not accepted",
          message: `Your product "${product.itemName}" was not accepted${req.body.reason ? `: ${req.body.reason}` : "."}`,
          data: { listingId: String(product._id) },
        });
      } catch (_) {}
    }

    return res.status(200).json({ success: true, message: "Product rejected", data: product });
  } catch (e) {
    console.error("[VSTORE_REJECT]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: mark a product picked up / received ──
exports.markPickedUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const product = await EquipmentListing.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.vendorStatus !== "ready_for_pickup") {
      return res.status(409).json({ success: false, message: `Product is "${product.vendorStatus}", not ready for pickup` });
    }
    product.vendorStatus = "acquired";
    product.vendorTimeline = product.vendorTimeline || {};
    product.vendorTimeline.pickedUpAt = new Date();
    await product.save();
    return res.status(200).json({ success: true, message: "Marked as picked up / acquired", data: product });
  } catch (e) {
    console.error("[VSTORE_PICKUP]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Platform vendor: set resale price + PUBLISH to the store ──
exports.publishProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const { vendorSalePrice } = req.body;
    if (vendorSalePrice == null || Number(vendorSalePrice) <= 0) {
      return res.status(400).json({ success: false, message: "A valid resale price is required" });
    }
    const product = await EquipmentListing.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    if (product.vendorStatus !== "acquired") {
      return res.status(409).json({ success: false, message: `Only acquired products can be published (current: "${product.vendorStatus}")` });
    }

    product.vendorStatus = "listed";
    product.vendorTimeline = product.vendorTimeline || {};
    product.vendorTimeline.listedAt = new Date();
    product.vendorSalePrice = Number(vendorSalePrice);
    // Mirror into askingPrice + status so the existing store feed/cards show the
    // resale price and treat it as a live listing (mobile changes are Phase 2).
    product.askingPrice = Number(vendorSalePrice);
    product.isDonation = false;
    product.status = "Active";
    product.lifecycleStatus = "approved";
    await product.save();

    return res.status(200).json({ success: true, message: "Product published to the store", data: product });
  } catch (e) {
    console.error("[VSTORE_PUBLISH]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── Seller: respond to the vendor's offer (accept / decline) ──
exports.respondToOffer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
    const { action } = req.body; // "accept" | "decline"
    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'accept' or 'decline'" });
    }
    const product = await EquipmentListing.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const me = String(req.user?.id || req.user?._id || "");
    if (String(product.seller) !== me) {
      return res.status(403).json({ success: false, message: "Only the seller can respond to this offer" });
    }
    if (product.vendorStatus !== "offer_made") {
      return res.status(409).json({ success: false, message: `No pending offer to respond to (status: "${product.vendorStatus}")` });
    }

    product.sellerRespondedAt = new Date();
    if (action === "accept") {
      product.vendorStatus = "ready_for_pickup";
      product.sellerOfferResponse = "accepted";
    } else {
      product.vendorStatus = "offer_declined";
      product.sellerOfferResponse = "declined";
    }
    await product.save();

    // Notify the handling vendor's account.
    try {
      if (product.handledByVendor) {
        const vp = await VendorProfile.findById(product.handledByVendor).select("userId").lean();
        if (vp?.userId) {
          await notifyPlayer(req.app, vp.userId, {
            type: "seller_offer_response",
            title: `Seller ${action === "accept" ? "accepted" : "declined"} your offer`,
            message: `"${product.itemName}" — the seller ${action === "accept" ? "accepted; ready for pickup." : "declined the offer."}`,
            data: { listingId: String(product._id) },
          });
        }
      }
    } catch (_) {}

    return res.status(200).json({ success: true, message: `Offer ${action}ed`, data: product });
  } catch (e) {
    console.error("[VSTORE_OFFER_RESP]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};
