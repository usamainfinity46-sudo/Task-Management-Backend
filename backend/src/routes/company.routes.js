import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createCompany, deleteCompany, listCompanies, updateCompany } from '../controllers/company.controller.js';

const router = Router();

router.use(authenticate, requireRole('admin'));
router.post('/', createCompany);
router.get('/', listCompanies);
router.patch('/:id', updateCompany);
router.delete('/:id', deleteCompany);

export default router;
