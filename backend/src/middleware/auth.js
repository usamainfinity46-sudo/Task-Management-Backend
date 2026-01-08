import { verifyAccessToken, verifyRefreshToken, signAccessToken, signRefreshToken } from '../utils/jwt.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';

const setAuthCookies = (res, accessToken, refreshToken) => {
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/'
  };
  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
};

export const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') return res.status(401).json({ message: 'Unauthorized' });
    req.user = { id: user._id.toString(), role: user.role, companyId: user.companyId?.toString() || null };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return refreshFlow(req, res, next);
    }
    next(err);
  }
};

const refreshFlow = async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') return res.status(401).json({ message: 'Unauthorized' });
    const accessToken = signAccessToken({ sub: user._id.toString(), role: user.role, companyId: user.companyId?.toString() || null });
    const refreshToken = signRefreshToken({ sub: user._id.toString() });
    setAuthCookies(res, accessToken, refreshToken);
    req.user = { id: user._id.toString(), role: user.role, companyId: user.companyId?.toString() || null };
    next();
  } catch (error) {
    next(error);
  }
};

export const issueTokens = (res, user) => {
  const accessToken = signAccessToken({ sub: user._id.toString(), role: user.role, companyId: user.companyId?.toString() || null });
  const refreshToken = signRefreshToken({ sub: user._id.toString() });
  setAuthCookies(res, accessToken, refreshToken);
};
