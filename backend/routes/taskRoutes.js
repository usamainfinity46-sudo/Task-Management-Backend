// routes/taskRoutes.js
import express from 'express';
import { 
    createTask, 
    getTasks, 
    getTask,
    updateTask,
    deleteTask,
    updateSubTask,
    getDashboardStats,
    getReport,
    exportToExcel, 
    deleteSubtask,
    addSubTask, 
    addSubTaskDay,
    getSubTaskReport
} from '../controllers/taskController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';
import { check } from 'express-validator';

const router = express.Router();

router.use(protect);

// Task CRUD operations
router.post('/', [
    check('title', 'Title is required').not().isEmpty(),
    check('assignedTo', 'Assigned to is required').not().isEmpty(),
    check('startDate', 'Start date is required').not().isEmpty(),
    check('endDate', 'End date is required').not().isEmpty()
], authorize(['admin', 'manager']), createTask);


// PUT SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES
router.get('/reports', authorize(['admin', 'manager']), getReport);
router.get('/reports/export', authorize(['admin', 'manager']), exportToExcel);
router.get('/reports/subtasks', protect, getSubTaskReport);
router.get('/dashboard/stats', getDashboardStats);

// THEN parameterized routes
router.get('/', getTasks);
router.get('/:id', getTask);
router.put('/:id',  authorize(['admin', 'manager']), updateTask);
router.delete('/:id',  authorize(['admin', 'manager']), deleteTask);

// Subtask routes

router.post('/:taskId/subtaskDays', authorize(['admin', 'staff']), protect, addSubTaskDay);
// router.post('/:taskId/subtasks', protect, addSubTask);

router.put('/:taskId/subtasks/:subTaskId', protect , updateSubTask);
router.delete('/:taskId/subtasks/:subTaskId', protect, deleteSubtask);

export default router;