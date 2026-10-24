import express from 'express';
import { getCompany, updateCompany } from '../controllers/companyController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);
router.get('/', getCompany);
router.put('/', authorize('admin'), updateCompany);

export default router;
