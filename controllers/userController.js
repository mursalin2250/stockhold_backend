import User from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json({ users: users.map((u) => u.toSafeObject()) });
});

// @desc    Get a single user
// @route   GET /api/users/:id
// @access  Private/Admin
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.json({ user: user.toSafeObject() });
});

// @desc    Create a new user (admin creating manager/staff/admin accounts)
// @route   POST /api/users
// @access  Private/Admin
export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' });
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return res.status(400).json({ message: 'A user with this email already exists' });
  }

  const user = await User.create({
    name,
    email,
    password,
    role: ['admin', 'manager', 'staff'].includes(role) ? role : 'staff',
  });

  res.status(201).json({ user: user.toSafeObject() });
});

// @desc    Update a user's role, name, or active status
// @route   PUT /api/users/:id
// @access  Private/Admin
export const updateUser = asyncHandler(async (req, res) => {
  const { name, role, isActive } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Prevent an admin from locking themselves out by deactivating/demoting their own account
  if (String(user._id) === String(req.user._id)) {
    if (isActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    if (role && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot change your own role' });
    }
  }

  if (name !== undefined) user.name = name;
  if (role !== undefined && ['admin', 'manager', 'staff'].includes(role)) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;

  await user.save();
  res.json({ user: user.toSafeObject() });
});

// @desc    Delete a user
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  await user.deleteOne();
  res.json({ message: 'User deleted successfully' });
});


// @desc    Admin resets a team member's password to a known default
// @route   PUT /api/users/:id/reset-password
// @access  Private/Admin
export const resetPassword = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({
      message: 'Use Settings to change your own password instead of resetting it here',
    });
  }

  const user = await User.findById(req.params.id).select('+password');
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Default temporary password so the member can log in and change it
  user.password = '12345678';
  // Invalidate any existing refresh sessions
  user.refreshTokens = [];
  await user.save();

  res.json({
    message: `Password for ${user.name} has been reset to 12345678`,
    user: user.toSafeObject(),
  });
});
