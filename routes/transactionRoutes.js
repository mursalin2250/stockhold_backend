import express from 'express';
import {
  getTransactions,
  getTransactionById,
  createTransaction,
} from '../controllers/transactionController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Stock log is restricted to admin and manager (staff cannot access)
router.use(protect, authorize('admin', 'manager'));

router.route('/').get(getTransactions).post(createTransaction);
router.route('/:id').get(getTransactionById);

export default router;
