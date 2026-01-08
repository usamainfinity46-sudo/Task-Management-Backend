import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createTask, deleteTask, listSubtasksByTask, listTasks, updateSubtask, updateTask } from '../controllers/task.controller.js';

const router = Router();

router.use(authenticate);

router.post('/', requireRole(['admin', 'manager']), createTask);
router.get('/', listTasks);
router.patch('/:id', requireRole(['admin', 'manager']), updateTask);
router.delete('/:id', requireRole(['admin', 'manager']), deleteTask);
router.get('/:id/subtasks', listSubtasksByTask);
router.patch('/subtasks/:subtaskId', updateSubtask);

export default router;
