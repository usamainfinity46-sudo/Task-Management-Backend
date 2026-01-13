import express from 'express';
import {
  getDashboardStats,
  getUserDashboard,
  getManagerDashboard,
  getAdminDashboard
} from '../controllers/dashboardController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All dashboard routes are protected
router.use(protect);

// Main dashboard stats (role-based)
router.get('/stats', protect , getDashboardStats);

// User-specific dashboard
router.get('/user', getUserDashboard);

// Manager dashboard
router.get('/manager', authorize(['admin', 'manager']), getManagerDashboard);

// Admin dashboard
router.get('/admin', authorize(['admin']), getAdminDashboard);

export default router;