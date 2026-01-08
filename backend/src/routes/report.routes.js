import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { generateMonthlyReport, listReports } from '../controllers/report.controller.js';

const router = Router();

router.use(authenticate, requireRole(['admin', 'manager']));
router.post('/:staffId', generateMonthlyReport);
router.get('/', listReports);

export default router;
