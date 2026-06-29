/**
 * VendorProfile — full vendor account profile (SuperAdmin "Create Vendor" flow).
 *
 * A vendor account = a User{role:"vendor"} + this profile. Created by SuperAdmin.
 * Drafts have NO User yet (userId null, status "draft", no email). On "Create
 * Account" (or promoting a draft to "active") a User is created and a
 * set-password invite is emailed (no plaintext password — Day-1 policy).
 *
 * Phase 1: all data fields + status workflow. Document/branding FILE UPLOADS are
 * stubbed — the path fields exist but multipart handling is a Phase-2 pass.
 */
const mongoose = require("mongoose");

const BUSINESS_TYPES = [
  "Sports Equipment Store",
  "Sports Apparel Store",
  "Nutrition Store",
  "Trophy & Awards Store",
  "Turf Equipment Supplier",
  "Multi-Sports Store",
  "Other",
];

const STATUSES = ["draft", "pending_verification", "active", "suspended", "rejected", "deactivated"];

const permissionDefaults = () => ({
  addProducts: false,
  editProducts: false,
  deleteProducts: false,
  viewOrders: false,
  manageOrders: false,
  cancelOrders: false,
  viewCustomers: false,
  contactCustomers: false,
  viewEarnings: false,
  downloadInvoices: false,
  createOffers: false,
  createCoupons: false,
});

const vendorProfileSchema = new mongoose.Schema(
  {
    // null while a draft (no login account yet); set when the account is created.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── Step 1: Basic ──
    businessName: { type: String, required: true, trim: true },
    businessType: { type: String, enum: BUSINESS_TYPES, default: "Other" },
    ownerName: { type: String, required: true, trim: true },
    phone: { type: String, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true },

    // ── Step 2: Address + Location ──
    address: {
      line: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
      postalCode: { type: String, default: "" },
    },
    location: {
      mapUrl: { type: String, default: "" },
      lat: { type: String, default: "" },
      lng: { type: String, default: "" },
    },

    // ── Step 3: Business details ──
    gstNumber: { type: String, default: "" },
    panNumber: { type: String, default: "" },
    businessRegNumber: { type: String, default: "" },
    licenseNumber: { type: String, default: "" },
    // Phase 2: file paths populated by upload handling.
    documents: {
      gstCertificate: { type: String, default: "" },
      businessRegCertificate: { type: String, default: "" },
      panCard: { type: String, default: "" },
      shopLicense: { type: String, default: "" },
    },
    documentsVerified: { type: Boolean, default: false },

    // ── Step 4: Categories ──
    sportsCategories: { type: [String], default: [] },
    productCategories: { type: [String], default: [] },

    // ── Step 5: Settings ──
    businessModel: { type: String, enum: ["Retail", "Wholesale", "Retail + Wholesale"], default: "Retail" },
    deliveryOptions: { type: [String], default: [] }, // Store Pickup | Local Delivery | Nationwide Delivery
    paymentSettlement: { type: String, enum: ["Weekly", "Bi-Weekly", "Monthly"], default: "Monthly" },
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },

    // ── Step 6: Credentials ──
    username: { type: String, default: "" },
    credentialDelivery: { type: String, enum: ["email", "sms", "both"], default: "email" },

    // ── Step 7: Permissions ──
    permissions: { type: Object, default: permissionDefaults },

    // ── Step 8: Branding ── (file paths Phase 2)
    branding: {
      logo: { type: String, default: "" },
      banner: { type: String, default: "" },
      gallery: { type: [String], default: [] },
    },
    description: { type: String, default: "", maxlength: 2000 },
    storeHighlights: { type: String, default: "" },
    workingHours: { type: String, default: "" },

    // ── Step 9: Inventory (optional) ──
    inventory: {
      productCategories: { type: [String], default: [] },
      skuPrefix: { type: String, default: "" },
      stockAlerts: { type: Boolean, default: false },
    },

    // ── Step 10 / workflow ──
    status: { type: String, enum: STATUSES, default: "draft" },

    // The ONE platform vendor that receives all player product uploads for
    // review (the app-owner middleman). Exactly one vendor should have this set.
    isPlatformVendor: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

// Unique account link only when a real User is attached (drafts share null userId).
vendorProfileSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
vendorProfileSchema.index({ email: 1 });
vendorProfileSchema.index({ status: 1 });

const VendorProfile = mongoose.model("VendorProfile", vendorProfileSchema);
VendorProfile.BUSINESS_TYPES = BUSINESS_TYPES;
VendorProfile.STATUSES = STATUSES;
VendorProfile.permissionDefaults = permissionDefaults;

module.exports = VendorProfile;
