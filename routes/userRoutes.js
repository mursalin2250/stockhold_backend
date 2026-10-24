import express from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// All user-management routes are admin-only
router.use(protect, authorize('admin'));

router.route('/').get(getUsers).post(createUser);
router.put('/:id/reset-password', resetPassword);
router.route('/:id').get(getUserById).put(updateUser).delete(deleteUser);

export default router;
