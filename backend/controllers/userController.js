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

    console.log("req.user.role ", req.user.company);


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


    // if (
    //   req.user.role === "manager" &&
    //   user.company.toString() !== req.user.company
    // ) {
    //   return res.status(403).json({ message: "Not authorized" });
    // }

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

    let { name, email, number, password, role, company, manager, isActive } =
      req.body;

    // Cast number safely
    if (number !== undefined) number = Number(number);

    // Default password if not provided
    password = password || "123456";

    // Only admin or manager allowed
    if (req.user.role !== "admin" && req.user.role !== "manager" && req.user.role !== "sub-admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Manager can only create users in their own company
    if (req.user.role === "manager") {
      company = req.user.company;
    }

    // Check user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Validate company
    const companyDoc = await Company.findById(company);
    if (!companyDoc) {
      return res.status(400).json({ message: "Company not found" });
    }


    const user = await User.create({
      name,
      email,
      number,
      plainPassword: password,
      password,
      role,
      company,
      manager,
      isActive,
    });
    await Company.findByIdAndUpdate(company, {
      $inc: { totalUser: 1 },
    });

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
    let { name, email, number, role, company, manager, isActive } = req.body;

    if (number !== undefined) {
      number = Number(number); // cast string to number
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldCompany = user.company?.toString();

    // ================= PERMISSIONS =================
    if (req.user.role === "staff" && user._id.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (req.user.role === "manager") {
      if (
        user.company.toString() !== req.user.company ||
        user.role !== "staff"
      ) {
        return res.status(403).json({ message: "Not authorized" });
      }
    }

    // ================= EMAIL CHECK =================
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    // ================= COMPANY CHANGE LOGIC =================
    if (company && oldCompany !== company) {
      const newCompany = await Company.findById(company);
      if (!newCompany) {
        return res.status(400).json({ message: "New company not found" });
      }

      // decrement old company
      if (oldCompany) {
        await Company.findByIdAndUpdate(oldCompany, {
          $inc: { totalUser: -1 },
        });
      }

      // increment new company
      await Company.findByIdAndUpdate(company, {
        $inc: { totalUser: 1 },
      });
    }

    // ================= UPDATE USER =================
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      {
        name,
        email,
        role,
        number,
        company,
        manager: manager || null,
        isActive,
        updatedAt: Date.now(),
      },
      { new: true, runValidators: true }
    ).select("-password");

    res.json({
      success: true,
      user: updatedUser,
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

    // Staff cannot delete users
    if (req.user.role === "staff") {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Manager restrictions
    if (req.user.role === "manager") {
      if (
        user.company.toString() !== req.user.company ||
        user.role !== "staff"
      ) {
        return res.status(403).json({
          message: "Not authorized to delete this user",
        });
      }
    }

    // Check assigned tasks
    const assignedTasks = await Task.countDocuments({
      assignedTo: user._id,
    });

    if (assignedTasks > 0) {
      return res.status(400).json({
        message: "Cannot delete user with assigned tasks",
      });
    }

    // Delete user
    await User.findByIdAndDelete(user._id);

    // 🔥 DECREMENT totalUser
    if (user.company) {
      await Company.findByIdAndUpdate(user.company, {
        $inc: { totalUser: -1 },
      });
    }

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
    let { name, email, number } = req.body;

    if (!number) {
      number = null
    }
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
        number,
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
// Modified changePassword that doesn't store plainPassword permanently
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters long"
      });
    }
    const user = await User.findById(req.user.id).select("+password");

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Check if new password is same as current
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        message: "New password cannot be the same as current password"
      });
    }

    // Update only the hashed password
    user.plainPassword = newPassword;
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
