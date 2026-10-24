import express from 'express';
import {
  getCustomers,
  getCustomerById,
  getCustomerSales,
  getCustomerPayments,
  recordCustomerPayment,
  setCustomerDue,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../controllers/customerController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// All authenticated roles can view and add customers; only admins can delete
// a customer (and only if they have no sales on record).
router.route('/').get(getCustomers).post(createCustomer);
router.route('/:id').get(getCustomerById).put(updateCustomer).delete(authorize('admin'), deleteCustomer);
router.get('/:id/sales', getCustomerSales);
router.get('/:id/payments', getCustomerPayments);
router.post('/:id/payments', recordCustomerPayment);
router.put('/:id/due', authorize('admin'), setCustomerDue);

export default router;
