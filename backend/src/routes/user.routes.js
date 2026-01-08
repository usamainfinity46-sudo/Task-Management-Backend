import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createUser, deleteUser, listUsers, updateUser } from '../controllers/user.controller.js';

const router = Router();

router.use(authenticate, requireRole(['admin', 'manager']));
router.post('/', createUser);
router.get('/', listUsers);
router.patch('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
