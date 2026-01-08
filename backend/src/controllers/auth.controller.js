import bcrypt from 'bcryptjs';
import { User } from '../models/user.model.js';
import { registerSchema, loginSchema } from '../validations/auth.schema.js';
import { issueTokens } from '../middleware/auth.js';

export const register = async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const exists = await User.findOne({ email: body.email });
    if (exists) return res.status(400).json({ message: 'Email already in use' });
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await User.create({
      name: body.name,
      email: body.email,
      role: body.role,
      companyId: body.companyId || null,
      managerId: body.managerId || null,
      passwordHash
    });
    issueTokens(res, user);
    res.status(201).json({ user: sanitize(user) });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    issueTokens(res, user);
    res.json({ user: sanitize(user) });
  } catch (err) {
    next(err);
  }
};

export const me = async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ user: sanitize(user) });
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
