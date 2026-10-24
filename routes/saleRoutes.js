import express from 'express';
import { getSales, getSaleById, createSale, recordPayment } from '../controllers/saleController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// All authenticated roles can record sales (it behaves like a stock-out) and
// view sales history.
router.route('/').get(getSales).post(createSale);
router.route('/:id').get(getSaleById);
router.post('/:id/payment', recordPayment);

export default router;
