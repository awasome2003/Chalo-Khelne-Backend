import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Store config values
const cloudinaryConfig = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
};

// Debug logging
console.log("🔧 Cloudinary Configuration:");
console.log("  Cloud Name:", cloudinaryConfig.cloud_name || "❌ MISSING");
console.log("  API Key:", cloudinaryConfig.api_key || "❌ MISSING");
console.log("  API Secret:", cloudinaryConfig.api_secret ? "✅ Set" : "❌ MISSING");

// Validate configuration
if (!cloudinaryConfig.cloud_name || !cloudinaryConfig.api_key || !cloudinaryConfig.api_secret) {
    console.error("\n❌ ERROR: Missing Cloudinary credentials in .env file");
    console.error("Please check your .env file contains:");
    console.error("  CLOUDINARY_CLOUD_NAME=your_cloud_name");
    console.error("  CLOUDINARY_API_KEY=your_api_key");
    console.error("  CLOUDINARY_API_SECRET=your_api_secret\n");
} else {
    // Configure cloudinary
    cloudinary.config(cloudinaryConfig);
    console.log("✅ Cloudinary configured successfully\n");

    // Test the connection (optional - comment out in production)
    cloudinary.api.ping()
        .then(result => {
            console.log("✅ Cloudinary connection test successful!");
            console.log("   Status:", result.status);
            console.log("");
        })
        .catch(error => {
            console.error("❌ Cloudinary connection test failed!");
            console.error("   Error:", error.message || error);
            console.error("   This might be a network issue or invalid credentials\n");
        });
}

export default cloudinary;