const mongoose = require("mongoose");
require("dotenv").config();
const User = require("./Modal/User");
const { Manager } = require("./Modal/ClubManager");

const checkManager = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const managerId = "696a1a4c812cda43d671a3e2";
        const manager = await Manager.findById(managerId);

        if (!manager) {
            console.log("Manager not found");
            process.exit(0);
        }

        console.log("Manager Name:", manager.name);
        console.log("Club ID:", manager.clubId);

        const parentUser = await User.findById(manager.clubId);
        if (!parentUser) {
            console.log("Parent User not found");
        } else {
            console.log("Parent User Name:", parentUser.name);
            console.log("Parent User Role:", parentUser.role);
            console.log("Is Corporate:", parentUser.role === "corporate_admin");
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

checkManager();
