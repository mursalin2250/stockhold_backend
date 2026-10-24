import express from 'express';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getLowStockProducts,
} from '../controllers/productController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/alerts/low-stock', getLowStockProducts);

router
  .route('/')
  .get(getProducts)
  .post(authorize('admin', 'manager'), createProduct);

router
  .route('/:id')
  .get(getProductById)
  .put(authorize('admin', 'manager'), updateProduct)
  .delete(authorize('admin'), deleteProduct);

export default router;
