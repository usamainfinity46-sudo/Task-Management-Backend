import Task from '../models/Task.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { validationResult } from 'express-validator';
import ExcelJS from 'exceljs';
import { format, subDays, eachDayOfInterval } from 'date-fns';

// ✅ CREATE TASK (Missing Function)

// ✅ CREATE TASK WITH DETAILED SUBTASKS
export const createTask = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { 
            title, 
            description, 
            assignedTo, 
            startDate, 
            endDate, 
            priority,
            company,
            subTaskDetails // Add this for custom subtasks
        } = req.body;

        // Validate assigned user exists
        const user = await User.findById(assignedTo);
        if (!user) {
            return res.status(404).json({ message: 'Assigned user not found' });
        }

        // Validate company exists
        if (company) {
            const companyExists = await Company.findById(company);
            if (!companyExists) {
                return res.status(404).json({ message: 'Company not found' });
            }
        }

        // Create task
        const task = await Task.create({
            title,
            description,
            company: company || req.user.company,
            assignedTo,
            assignedBy: req.user.id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            priority: priority || 'medium'
        });

        // ✅ Generate subtasks based on user input or default
        let subTasks = [];
        
        if (subTaskDetails && Array.isArray(subTaskDetails) && subTaskDetails.length > 0) {
            // Use custom subtasks provided by manager
            subTasks = subTaskDetails.map((subTask, index) => ({
                date: new Date(subTask.date || startDate),
                description: subTask.description || `${title} - Day ${index + 1}`,
                status: 'pending',
                hoursSpent: 0,
                remarks: ''
            }));
        } else {
            // Generate default daily subtasks - EXCLUDING SUNDAYS
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            let dayCounter = 1;
            let currentDate = new Date(start);
            
            while (currentDate <= end) {
                // Check if it's NOT Sunday (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
                if (currentDate.getDay() !== 0) {
                    subTasks.push({
                        date: new Date(currentDate),
                        description: `${title} - Day ${dayCounter}`,
                        status: 'pending',
                        hoursSpent: 0,
                        remarks: ''
                    });
                    dayCounter++;
                }
                
                // Move to next day
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }

        // Update task with subtasks
        task.subTasks = subTasks;
        await task.save();

        // Populate and return the task
        const populatedTask = await Task.findById(task._id)
            .populate('assignedTo', 'name email')
            .populate('assignedBy', 'name email')
            .populate('company', 'name');

        res.status(201).json({
            success: true,
            task: populatedTask
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ ADD SUBTASK TO EXISTING TASK (NEW FUNCTION)
export const addSubTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { date, description, status, hoursSpent, remarks } = req.body;

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission (only manager or assigned staff can add subtasks)
        if (req.user.role === 'staff' && task.assignedTo.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to add subtasks to this task' });
        }

        // Create new subtask
        const newSubTask = {
            date: new Date(date),
            description,
            status: status || 'pending',
            hoursSpent: hoursSpent || 0,
            remarks: remarks || '',
            createdAt: new Date()
        };

        // Add to task
        task.subTasks.push(newSubTask);
        await task.save();

        res.json({
            success: true,
            message: 'Subtask added successfully',
            subTask: newSubTask
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// controllers/taskController.js

// ✅ DELETE SUBTASK (NEW FUNCTION)
export const deleteSubtask = async (req, res) => {
    try {
        const { taskId, subTaskId } = req.params;

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission
        if (req.user.role === 'staff' && task.assignedTo.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to delete subtasks from this task' });
        }

        // Remove subtask
        task.subTasks = task.subTasks.filter(subTask => subTask._id.toString() !== subTaskId);
        
        // Recalculate progress
        const completedSubTasks = task.subTasks.filter(st => st.status === 'completed').length;
        task.progress = task.subTasks.length > 0 
            ? Math.round((completedSubTasks / task.subTasks.length) * 100)
            : 0;
        
        // Update overall task status
        if (task.progress === 100) {
            task.status = 'completed';
        } else if (task.progress > 0 && task.status === 'pending') {
            task.status = 'in-progress';
        }

        await task.save();

        res.json({
            success: true,
            message: 'Subtask deleted successfully',
            task: await Task.findById(taskId)
                .populate('assignedTo', 'name email')
                .populate('assignedBy', 'name email')
                .populate('company', 'name')
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ GET SUBTASK REPORT BY MONTH (NEW FUNCTION)
export const getSubTaskReport = async (req, res) => {
    try {
        const { 
            month = new Date().getMonth() + 1, 
            year = new Date().getFullYear(),
            userId,
            taskId 
        } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        let query = {};

        if (taskId) {
            query._id = taskId;
        }
        
        // Apply role-based filtering
        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        // Find tasks with subtasks in the specified month
        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email role')
            .populate('company', 'name');

        // Filter subtasks by month
        const monthlyReport = [];

        tasks.forEach(task => {
            const monthlySubTasks = task.subTasks.filter(subTask => {
                const subTaskDate = new Date(subTask.date);
                return subTaskDate >= startDate && subTaskDate <= endDate;
            });

            if (monthlySubTasks.length > 0) {
                monthlyReport.push({
                    taskId: task._id,
                    taskTitle: task.title,
                    assignedTo: task.assignedTo?.name,
                    company: task.company?.name,
                    subTasks: monthlySubTasks.map(subTask => ({
                        date: subTask.date,
                        description: subTask.description,
                        status: subTask.status,
                        hoursSpent: subTask.hoursSpent,
                        remarks: subTask.remarks,
                        completedAt: subTask.completedAt
                    })),
                    totalHours: monthlySubTasks.reduce((sum, st) => sum + (st.hoursSpent || 0), 0),
                    completedSubtasks: monthlySubTasks.filter(st => st.status === 'completed').length,
                    totalSubtasks: monthlySubTasks.length
                });
            }
        });

        // Calculate summary
        const summary = {
            totalTasks: monthlyReport.length,
            totalSubtasks: monthlyReport.reduce((sum, task) => sum + task.totalSubtasks, 0),
            completedSubtasks: monthlyReport.reduce((sum, task) => sum + task.completedSubtasks, 0),
            totalHours: monthlyReport.reduce((sum, task) => sum + task.totalHours, 0),
            completionRate: monthlyReport.reduce((sum, task) => sum + task.completedSubtasks, 0) > 0 
                ? Math.round((monthlyReport.reduce((sum, task) => sum + task.completedSubtasks, 0) / 
                            monthlyReport.reduce((sum, task) => sum + task.totalSubtasks, 0)) * 100)
                : 0
        };

        res.json({
            success: true,
            report: {
                period: {
                    month,
                    year,
                    startDate,
                    endDate
                },
                summary,
                details: monthlyReport
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ GET TASKS (Missing Function)
export const getTasks = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status, 
            priority, 
            assignedTo,
            company,
            startDate,
            endDate,
            search 
        } = req.query;

        const query = {};

        // Apply role-based filtering
        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        // Apply filters
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (assignedTo) query.assignedTo = assignedTo;
        if (company) query.company = company;
        
        // Date range filter
        if (startDate && endDate) {
            query.startDate = { $gte: new Date(startDate) };
            query.endDate = { $lte: new Date(endDate) };
        }

        // Search functionality
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email')
            .populate('assignedBy', 'name email')
            .populate('company', 'name')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const total = await Task.countDocuments(query);

        res.json({
            success: true,
            tasks,
            total,
            pages: Math.ceil(total / limit),
            page: parseInt(page)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ GET SINGLE TASK (Missing Function)
// In getTask function in taskController.js
export const getTask = async (req, res) => {
    try {
   const { 
            month = new Date().getMonth() + 1, 
            year = new Date().getFullYear(),
            userId,
            companyId,
            reportType = 'monthly' // Add reportType parameter
        } = req.query;

        // Calculate date range based on reportType
        let startDate, endDate;
        
        if (reportType === 'quarterly') {
            const quarter = Math.ceil(month / 3);
            startDate = new Date(year, (quarter - 1) * 3, 1);
            endDate = new Date(year, quarter * 3, 0);
        } else if (reportType === 'yearly') {
            startDate = new Date(year, 0, 1);
            endDate = new Date(year, 11, 31);
        } else {
            // Monthly (default)
            startDate = new Date(year, month - 1, 1);
            endDate = new Date(year, month, 0);
        }

        let query = {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
        };

        // Apply filters
        if (userId) query.assignedTo = userId;
        if (companyId) query.company = companyId;
        
        // Apply role-based filtering
        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email role')
            .populate('assignedBy', 'name email')
            .populate('company', 'name')
            .sort({ createdAt: -1 });

        if (!tasks) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission
        if (req.user.role === 'staff' && task.assignedTo._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to view this task' });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ UPDATE SUBTASK (Missing Function)
export const updateSubTask = async (req, res) => {
    try {
        const { taskId, subTaskId } = req.params;
        const { status, hoursSpent, remarks } = req.body;

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission
        if (req.user.role === 'staff' && task.assignedTo.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to update this task' });
        }

        const subTask = task.subTasks.id(subTaskId);
        if (!subTask) {
            return res.status(404).json({ message: 'Subtask not found' });
        }

        // Update subtask fields
        subTask.status = status || subTask.status;
        subTask.hoursSpent = hoursSpent || subTask.hoursSpent;
        subTask.remarks = remarks || subTask.remarks;
        subTask.updatedAt = Date.now();

        // Mark as completed with timestamp
        if (status === 'completed' && subTask.status !== 'completed') {
            subTask.completedAt = new Date();
        }

        // Recalculate overall task progress
        const completedSubTasks = task.subTasks.filter(st => st.status === 'completed').length;
        task.progress = Math.round((completedSubTasks / task.subTasks.length) * 100);

        // Update overall task status
        if (task.progress === 100) {
            task.status = 'completed';
        } else if (task.progress > 0 && task.status === 'pending') {
            task.status = 'in-progress';
        }

        await task.save();

        res.json({
            success: true,
            task: await Task.findById(taskId)
                .populate('assignedTo', 'name email')
                .populate('assignedBy', 'name email')
                .populate('company', 'name')
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ GET DASHBOARD STATS (Provided earlier)
export const getDashboardStats = async (req, res) => {
    try {
        let query = {};

        // Apply role-based filtering
        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        const totalTasks = await Task.countDocuments(query);
        const completedTasks = await Task.countDocuments({ ...query, status: 'completed' });
        const pendingTasks = await Task.countDocuments({ ...query, status: 'pending' });
        const inProgressTasks = await Task.countDocuments({ ...query, status: 'in-progress' });

        // Get tasks for the last 7 days
        const sevenDaysAgo = subDays(new Date(), 7);
        const recentTasksQuery = {
            ...query,
            createdAt: { $gte: sevenDaysAgo }
        };
        
        const recentTasks = await Task.find(recentTasksQuery)
            .populate('assignedTo', 'name')
            .sort({ createdAt: -1 })
            .limit(5);

        // Calculate completion rate
        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Get weekly data for chart
        const weeklyData = [];
        for (let i = 6; i >= 0; i--) {
            const date = subDays(new Date(), i);
            const dayStart = new Date(date.setHours(0, 0, 0, 0));
            const dayEnd = new Date(date.setHours(23, 59, 59, 999));

            const dayQuery = {
                ...query,
                createdAt: { $gte: dayStart, $lte: dayEnd }
            };

            const dayTasks = await Task.countDocuments(dayQuery);
            const dayCompleted = await Task.countDocuments({ 
                ...dayQuery, 
                status: 'completed' 
            });

            weeklyData.push({
                name: format(date, 'EEE'),
                date: format(date, 'MMM dd'),
                tasks: dayTasks,
                completed: dayCompleted,
                pending: dayTasks - dayCompleted
            });
        }

        res.json({
            success: true,
            stats: {
                totalTasks,
                completedTasks,
                pendingTasks,
                inProgressTasks,
                completionRate,
                recentTasks: recentTasks.map(task => ({
                    id: task._id,
                    title: task.title,
                    assignedTo: task.assignedTo?.name,
                    status: task.status,
                    progress: task.progress,
                    createdAt: task.createdAt
                })),
                weeklyData
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ GET REPORT (Provided earlier)
export const getReport = async (req, res) => {
    try {
        const { 
            month = new Date().getMonth() + 1, 
            year = new Date().getFullYear(),
            userId,
            companyId 
        } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        let query = {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
        };

        // Apply filters
        if (userId) query.assignedTo = userId;
        if (companyId) query.company = companyId;
        
        // Apply role-based filtering
        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email role')
            .populate('assignedBy', 'name email')
            .populate('company', 'name')
            .sort({ createdAt: -1 });

        // Generate report data
        const reportData = tasks.map(task => ({
            taskId: task._id,
            title: task.title,
            assignedTo: task.assignedTo?.name,
            assignedToEmail: task.assignedTo?.email,
            assignedToRole: task.assignedTo?.role,
            company: task.company?.name,
            startDate: task.startDate,
            endDate: task.endDate,
            status: task.status,
            priority: task.priority,
            progress: task.progress,
            totalHours: task.subTasks.reduce((sum, sub) => sum + (sub.hoursSpent || 0), 0),
            completedSubtasks: task.subTasks.filter(st => st.status === 'completed').length,
            totalSubtasks: task.subTasks.length,
            createdAt: task.createdAt
        }));

        // Calculate summary statistics
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const pendingTasks = tasks.filter(t => t.status === 'pending').length;
        const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
        const totalHours = reportData.reduce((sum, task) => sum + task.totalHours, 0);
        const avgProgress = totalTasks > 0 ? 
            Math.round(reportData.reduce((sum, task) => sum + task.progress, 0) / totalTasks) : 0;

        // Group by user for detailed analysis
        const userReports = {};
        reportData.forEach(task => {
            const userId = task.assignedTo;
            if (!userReports[userId]) {
                userReports[userId] = {
                    userId,
                    name: task.assignedTo,
                    email: task.assignedToEmail,
                    totalTasks: 0,
                    completedTasks: 0,
                    totalHours: 0,
                    avgProgress: 0
                };
            }
            userReports[userId].totalTasks++;
            userReports[userId].totalHours += task.totalHours;
            if (task.status === 'completed') {
                userReports[userId].completedTasks++;
            }
        });

        // Calculate average progress per user
        Object.keys(userReports).forEach(userId => {
            const userTasks = reportData.filter(task => task.assignedTo === userId);
            userReports[userId].avgProgress = userTasks.length > 0 ?
                Math.round(userTasks.reduce((sum, task) => sum + task.progress, 0) / userTasks.length) : 0;
        });

        res.json({
            success: true,
            report: {
                period: {
                    month,
                    year,
                    startDate,
                    endDate
                },
                summary: {
                    totalTasks,
                    completedTasks,
                    pendingTasks,
                    inProgressTasks,
                    totalHours,
                    avgProgress,
                    completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
                },
                detailed: reportData,
                userReports: Object.values(userReports),
                chartData: [
                    { name: 'Completed', value: completedTasks, color: '#4CAF50' },
                    { name: 'In Progress', value: inProgressTasks, color: '#2196F3' },
                    { name: 'Pending', value: pendingTasks, color: '#FF9800' }
                ]
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ UPDATE TASK (Provided earlier)
export const updateTask = async (req, res) => {
    try {
        const { title, description, assignedTo, startDate, endDate, priority, status } = req.body;

        let task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission
        if (req.user.role === 'staff' && task.assignedTo.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to update this task' });
        }

        task = await Task.findByIdAndUpdate(
            req.params.id,
            {
                title,
                description,
                assignedTo,
                startDate,
                endDate,
                priority,
                status,
                updatedAt: Date.now()
            },
            { new: true, runValidators: true }
        ).populate('assignedTo', 'name email')
         .populate('assignedBy', 'name email')
         .populate('company', 'name');

        res.json({
            success: true,
            task
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ✅ DELETE TASK (Provided earlier)
export const deleteTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check permission
        if (req.user.role === 'staff') {
            return res.status(403).json({ message: 'Not authorized to delete tasks' });
        }


        await Task.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


export const exportToExcel = async (req, res) => {
    try {
        const { 
            month = new Date().getMonth() + 1, 
            year = new Date().getFullYear(),
            companyId 
        } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        let query = {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
        };

        if (companyId) {
            query.company = companyId;
        } else if (req.user.role === 'manager') {
            query.company = req.user.company;
        }

        if (req.user.role === 'staff') {
            query.assignedTo = req.user.id;
        }

        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email role')
            .populate('assignedBy', 'name email')
            .populate('company', 'name');

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Tasks Report');

        // Define columns
        worksheet.columns = [
            { header: 'SR #', key: 'srNo', width: 25 },
            { header: 'Title', key: 'title', width: 30 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'Assigned To', key: 'assignedTo', width: 20 },
            { header: 'Assigned To Email', key: 'assignedToEmail', width: 25 },
            { header: 'Assigned By', key: 'assignedBy', width: 20 },
            { header: 'Company', key: 'company', width: 20 },
            { header: 'Start Date', key: 'startDate', width: 12 },
            { header: 'End Date', key: 'endDate', width: 12 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Priority', key: 'priority', width: 10 },
            { header: 'Progress', key: 'progress', width: 10 },
            { header: 'Total Hours', key: 'totalHours', width: 12 },
            { header: 'Completed Subtasks', key: 'completedSubtasks', width: 18 },
            { header: 'Total Subtasks', key: 'totalSubtasks', width: 15 },
            { header: 'Created At', key: 'createdAt', width: 12 }
        ];

        // Add data rows
        tasks.forEach((task, index) => {
            worksheet.addRow({
                srNo: index +1 ,
                title: task.title,
                description: task.description || '',
                assignedTo: task.assignedTo?.name || 'Unassigned',
                assignedToEmail: task.assignedTo?.email || '',
                assignedBy: task.assignedBy?.name || '',
                company: task.company?.name || '',
                startDate: task.startDate.toISOString().split('T')[0],
                endDate: task.endDate.toISOString().split('T')[0],
                status: task.status,
                priority: task.priority,
                progress: `${task.progress}%`,
                totalHours: task.subTasks.reduce((sum, sub) => sum + (sub.hoursSpent || 0), 0),
                completedSubtasks: task.subTasks.filter(st => st.status === 'completed').length,
                totalSubtasks: task.subTasks.length,
                createdAt: task.createdAt.toISOString().split('T')[0]
            });
        });

        // Style the header row
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
        });

        // Set response headers for file download
        const fileName = `tasks_report_${month}_${year}.xlsx`;
        
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${fileName}"`
        );

        // Write workbook to response
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ message: error.message });
    }
};