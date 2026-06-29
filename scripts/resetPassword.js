/**
 * Reset a User's password (dev/admin utility).
 *
 * Uses findById/findOne + .save() so the User pre-save hook bcrypt-hashes the
 * new password (updateOne would store plaintext and break login).
 *
 * Usage:
 *   node scripts/resetPassword.js <emailOrUserId> <newPassword>
 *
 * Examples:
 *   node scripts/resetPassword.js elitesports@chalokhelne.com "EliteSports@123"
 *   node scripts/resetPassword.js 6a1eadc11239689b986c8485 "EliteSports@123"
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../src/modules/identity/models/User");

async function run() {
  const [ident, newPassword] = process.argv.slice(2);
  if (!ident || !newPassword) {
    console.error('Usage: node scripts/resetPassword.js <emailOrUserId> "<newPassword>"');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const query = mongoose.isValidObjectId(ident)
    ? { _id: ident }
    : { email: ident.toLowerCase() };
  const user = await User.findOne(query);
  if (!user) {
    console.error(`No User found for "${ident}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.password = newPassword;           // pre-save hook bcrypt-hashes this
  user.passwordChangedAt = new Date();   // invalidates old reset tokens
  await user.save();

  console.log("✅ Password reset for:");
  console.log(`   name:  ${user.name}`);
  console.log(`   email: ${user.email}`);
  console.log(`   role:  ${user.role}`);
  console.log(`   _id:   ${user._id}`);
  console.log(`\nNew password: ${newPassword}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Reset failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
