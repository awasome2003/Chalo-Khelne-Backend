const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Superadminmodel = require("./Modal/Superadminmodel");
require("dotenv").config();

const createSuperAdmin = async () => {
    const email = process.argv[2];
    const password = process.argv[3];

    if (!email || !password) {
        console.log("Usage: node createSuperAdmin.js <email> <password>");
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB");

        const existingAdmin = await Superadminmodel.findOne({ email });
        if (existingAdmin) {
            console.log("SuperAdmin already exists with this email.");
            process.exit(0);
        }

        // Password hashing is handled in pre-save hook of Superadminmodel
        // But let's check the model: Step 109: YES, it has a pre-save hook.
        // So we just save plain text password.

        const newAdmin = new Superadminmodel({
            email,
            password,
        });

        await newAdmin.save();
        console.log(`SuperAdmin created successfully: ${email}`);
        process.exit(0);
    } catch (error) {
        console.error("Error creating SuperAdmin:", error);
        process.exit(1);
    }
};

createSuperAdmin();
