import bcrypt from 'bcryptjs';
import { User } from '../models/user.model.js';
import { createUserSchema, updateUserSchema } from '../validations/user.schema.js';

export const createUser = async (req, res, next) => {
  try {
    const body = createUserSchema.parse(req.body);
    const exists = await User.findOne({ email: body.email });
    if (exists) return res.status(400).json({ message: 'Email already exists' });
    const passwordHash = await bcrypt.hash(body.password, 10);
    const companyId = req.user.role === 'admin' ? body.companyId : req.user.companyId;
    const user = await User.create({
      name: body.name,
      email: body.email,
      role: body.role,
      companyId,
      managerId: body.managerId || (req.user.role === 'manager' ? req.user.id : undefined),
      status: body.status || 'active',
      passwordHash
    });
    res.status(201).json({ user: sanitize(user) });
  } catch (err) {
    next(err);
  }
};

export const listUsers = async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
    const users = await User.find(filter).select('-passwordHash').sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const body = updateUserSchema.parse(req.body);
    const update = { ...body };
    if (body.password) update.passwordHash = await bcrypt.hash(body.password, 10);
    delete update.password;
    const filter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, companyId: req.user.companyId };
    const user = await User.findOneAndUpdate(filter, update, { new: true });
    res.json({ user: sanitize(user) });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, companyId: req.user.companyId };
    await User.findOneAndDelete(filter);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const sanitize = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  companyId: user.companyId,
  managerId: user.managerId,
  status: user.status
});
