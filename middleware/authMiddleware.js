const jwt = require("jsonwebtoken");
const Manager = require("../Modal/ClubManager").Manager;

const User = require("../Modal/User");

// Middleware to verify JWT token for managers
exports.managerAuth = async (req, res, next) => {
  // Check if the Authorization header is present
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    return res
      .status(401)
      .json({ message: "Authorization denied. No token provided." });
  }

  // Ensure the token is properly formatted
  const token = authHeader.replace("Bearer ", "");

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const manager = await Manager.findById(decoded.id);

    if (!manager) {
      return res.status(401).json({ message: "Manager not found." });
    }

    // Store the decoded user in the request object for use in the next middleware
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token." });
  }
};

exports.authenticate = async (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    return res
      .status(401)
      .json({ message: "Authorization denied. No token provided." });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token." });
  }
};

exports.allowUserOrManager = async (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    return res.status(401).json({ message: "Authorization denied. No token provided." });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = await User.findById(decoded.id);
    if (user) {
      req.user = user;
      req.userRole = "User";
      return next();
    }

    const manager = await Manager.findById(decoded.id);
    if (manager) {
      req.user = manager;
      req.userRole = "Manager";
      return next();
    }

    return res.status(401).json({ message: "User or Manager not found." });
  } catch (err) {
    return res.status(401).json({ message: "Invalid token." });
  }
};
