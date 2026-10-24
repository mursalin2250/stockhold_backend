import express from 'express';
import { getSummary } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/summary', protect, getSummary);

export default router;
