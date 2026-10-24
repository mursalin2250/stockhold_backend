import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const generateAccessToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

const generateRefreshToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

const REFRESH_COOKIE_NAME = 'refreshToken';

const isProd = process.env.NODE_ENV === 'production';

/** Cookie options for refresh token (must match on set + clear). */
const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd, // HTTPS only in production (Cloudflare / tunnel)
  sameSite: isProd ? 'lax' : 'lax', // works with same-site app on stockhold.dpdns.org
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/auth',
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

const MAX_REFRESH_TOKENS = 10;

async function addRefreshToken(userId, token) {
  const user = await User.findById(userId).select('+refreshTokens');
  if (!user) return;
  const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens.filter(Boolean) : [];
  tokens.push(token);
  // Keep only the most recent sessions
  user.refreshTokens = tokens.slice(-MAX_REFRESH_TOKENS);
  await user.save();
}

async function removeRefreshToken(userId, token) {
  const user = await User.findById(userId).select('+refreshTokens');
  if (!user) return;
  user.refreshTokens = (user.refreshTokens || []).filter((t) => t && t !== token);
  await user.save();
}

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
// NOTE: In production you likely want to restrict who can create 'admin' or
// 'manager' accounts (e.g. only an existing admin via the /users endpoint).
// Here, self-registration always creates a 'staff' account for safety;
// the first user ever created is promoted to 'admin' automatically.
// @desc    Whether public registration is still open
// @route   GET /api/auth/registration-status
// @access  Public
export const getRegistrationStatus = asyncHandler(async (req, res) => {
  const adminCount = await User.countDocuments({ role: 'admin' });
  res.json({
    open: adminCount < 2,
    adminCount,
  });
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  // Once 2 admins exist, public signup is closed — admins invite via Team
  const adminCount = await User.countDocuments({ role: 'admin' });
  if (adminCount >= 2) {
    return res.status(403).json({
      message: 'Public registration is closed. Ask an admin to create your account.',
      code: 'REGISTRATION_CLOSED',
    });
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({ message: 'A user with this email already exists' });
  }

  const userCount = await User.countDocuments();
  // First account is admin; second open signup is also admin until 2 admins exist
  const role = adminCount < 2 ? 'admin' : 'staff';

  const user = await User.create({ name, email, password, role });

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await addRefreshToken(user._id, refreshToken);

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

  res.status(201).json({
    user: user.toSafeObject(),
    accessToken,
  });
});

// @desc    Authenticate user & get tokens
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  if (!user.isActive) {
    return res.status(403).json({ message: 'Account has been deactivated. Contact an admin.' });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await addRefreshToken(user._id, refreshToken);

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

  res.json({
    user: user.toSafeObject(),
    accessToken,
  });
});

// @desc    Exchange a valid refresh token (httpOnly cookie) for a new access token
// @route   POST /api/auth/refresh
// @access  Public (requires valid refresh cookie)
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ message: 'No refresh token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Refresh token invalid or expired' });
  }

  const user = await User.findById(decoded.id).select('+refreshTokens');
  if (!user || !user.isActive) {
    return res.status(401).json({ message: 'Refresh token invalid' });
  }
  const tokens = user.refreshTokens || [];
  if (!tokens.includes(token)) {
    return res.status(401).json({ message: 'Refresh token invalid' });
  }

  const accessToken = generateAccessToken(user);
  res.json({ accessToken });
});

// @desc    Log the current user out and invalidate their refresh token
// @route   POST /api/auth/logout
// @access  Private
export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      // Only remove this device's session — other devices stay logged in
      await removeRefreshToken(decoded.id, token);
    } catch (error) {
      // token already invalid/expired - nothing to clean up
    }
  }

  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/api/auth',
    secure: isProd,
    sameSite: isProd ? 'lax' : 'lax',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  res.json({ message: 'Logged out successfully' });
});

// @desc    Get the currently authenticated user's profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeObject() });
});

// @desc    Change the current user's own password
// @route   PUT /api/auth/change-password
// @access  Private
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(401).json({ message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  res.json({ message: 'Password updated successfully' });
});


// @desc    Update the current user's profile (name, avatar)
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, email, avatar } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'Name cannot be empty' });
    }
    user.name = trimmed;
  }

  if (email !== undefined) {
    const normalized = String(email).trim().toLowerCase();
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      return res.status(400).json({ message: 'Please provide a valid email' });
    }
    if (normalized !== user.email) {
      const taken = await User.findOne({ email: normalized, _id: { $ne: user._id } });
      if (taken) {
        return res.status(400).json({ message: 'A user with this email already exists' });
      }
      user.email = normalized;
    }
  }

  if (avatar !== undefined) {
    // Avatar is expected as a compressed data URL from the client
    user.avatar = avatar || '';
  }

  await user.save();
  res.json({ user: user.toSafeObject() });
});
