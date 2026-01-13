import express from 'express';
import { 
    getUsers, 
    getUser, 
    createUser, 
    updateUser, 
    deleteUser,
    updateProfile,
    changePassword 
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { check } from 'express-validator';

const router = express.Router();

router.use(protect);

router.post('/', [
    check('name', 'Name is required').not().isEmpty(),
    check('email', 'Please include a valid email').isEmail(),
    check('role', 'Role is required').not().isEmpty(),
    protect,
], authorize(['admin', 'manager']), createUser);


// Profile routes (accessible to all authenticated users)
router.put('/profile', [
    check('name', 'Name is required').optional().not().isEmpty(),
    check('email', 'Please include a valid email').optional().isEmail(), authorize(['admin', 'manager'])
], updateProfile);

router.put('/change-password', [
    check('currentPassword', 'Current password is required').not().isEmpty(),
    check('newPassword', 'New password must be at least 6 characters').isLength({ min: 6 })
], changePassword);

// User management routes
router.get('/', protect, getUsers);
router.get('/:id', authorize(['admin', 'manager']), getUser);


router.put('/:id', authorize(['admin', 'manager']), updateUser);
router.delete('/:id', authorize(['admin', 'manager']), deleteUser);

export default router;