import express from 'express';
import {
  getSuppliers,
  getSupplierById,
  getSupplierPurchases,
  recordSupplierPayment,
  setSupplierDue,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '../controllers/supplierController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(getSuppliers)
  .post(authorize('admin', 'manager'), createSupplier);

router.post('/:id/payments', authorize('admin', 'manager'), recordSupplierPayment);
router.put('/:id/due', authorize('admin'), setSupplierDue);
router.get('/:id/purchases', getSupplierPurchases);

router
  .route('/:id')
  .get(getSupplierById)
  .put(authorize('admin', 'manager'), updateSupplier)
  .delete(authorize('admin', 'manager'), deleteSupplier);

export default router;
