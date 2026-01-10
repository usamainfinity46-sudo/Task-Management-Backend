import express from 'express';
import { 
    createCompany, 
    getCompanies, 
    getCompany, 
    updateCompany, 
    deleteCompany,
    getCompanyStats 
} from '../controllers/companyController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { check } from 'express-validator';

const router = express.Router();

router.use(protect);

// Admin only routes
router.post('/', [
    check('name', 'Company name is required').not().isEmpty(),
    check('email', 'Please include a valid email').optional().isEmail()
], authorize(['admin']), createCompany);

router.get('/', authorize(['admin', 'manager' ]), getCompanies);
router.get('/:id', authorize(['admin']), getCompany);
router.put('/:id', authorize(['admin']), updateCompany);
router.delete('/:id', authorize(['admin']), deleteCompany);
router.get('/:id/stats', authorize(['admin']), getCompanyStats);

export default router;