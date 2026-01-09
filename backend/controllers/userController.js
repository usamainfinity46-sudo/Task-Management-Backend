import User from "../models/User.js";
import Company from "../models/Company.js";
import { validationResult } from "express-validator";
import Task from "../models/Task.js";

export const getUsers = async (req, res) => {
  try {
    const { role, company, isActive, search } = req.query;
    const query = {};

    // Apply filters from query (except role, we'll handle it)
    if (company) query.company = company;
    if (isActive !== undefined) query.isActive = isActive === "true";

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Role-based filtering
    if (req.user.role === "manager") {
      // Manager can only see staff and other managers in their company
      query.company = req.user.company;

      // Exclude admin explicitly
      query.role = { $in: ["staff", "manager"] }; // never include 'admin'
    } else if (req.user.role === "staff") {
      // Staff can only see themselves
      query._id = req.user._id;
    }

    const users = await User.find(query)
      .select("-password")
      .populate("company", "name")
      .populate("manager", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("company", "name")
      .populate("manager", "name email");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check permission
    if (req.user.role === "staff" && user._id.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (
      req.user.role === "manager" &&
      user.company.toString() !== req.user.company
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // console.log(req.user.company);
    

    let { name, email, password, role, company, manager, isActive } =
      req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    if(req.user.role === 'manager'){
      company = req.user.company;
    }

    // Check permissions
    if (req.user.role !== "manager" || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Not authorized to create this user" });
    }

    // Validate company exists
    if (company) {
      const companyExists = await Company.findById(company);
      if (!companyExists) {
        return res.status(400).json({ message: "Company not found" });
      }
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      company,
      manager,
      isActive,
    });

    // Remove password from response
    user.password = undefined;

    res.status(201).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { name, email, role, company, manager, isActive } = req.body;

    let user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check permissions
    if (req.user.role === "staff" && user._id.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this user" });
    }

    if (req.user.role === "manager") {
      // Managers can only update staff in their company
      if (
        user.company.toString() !== req.user.company ||
        user.role !== "staff"
      ) {
        return res
          .status(403)
          .json({ message: "Not authorized to update this user" });
      }
    }

    // Check if email is being changed and if it already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    user = await User.findByIdAndUpdate(
      req.params.id,
      {
        name,
        email,
        role,
        company,
        manager: manager || null,
        isActive,
        updatedAt: Date.now(),
      },
      { new: true, runValidators: true }
    ).select("-password");

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check permissions
    if (req.user.role === "staff") {
      return res
        .status(403)
        .json({ message: "Not authorized to delete users" });
    }

    if (req.user.role === "manager") {
      // Managers can only delete staff in their company
      if (
        user.company.toString() !== req.user.company ||
        user.role !== "staff"
      ) {
        return res
          .status(403)
          .json({ message: "Not authorized to delete this user" });
      }
    }

    // Check if user has assigned tasks
    const assignedTasks = await Task.countDocuments({ assignedTo: user._id });
    if (assignedTasks > 0) {
      return res.status(400).json({
        message:
          "Cannot delete user with assigned tasks. Reassign tasks first.",
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    // Check if email is being changed and if it already exists
    if (email && email !== req.user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        name,
        email,
        updatedAt: Date.now(),
      },
      { new: true, runValidators: true }
    ).select("-password");

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select("+password");

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
