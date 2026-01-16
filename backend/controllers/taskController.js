import Task from '../models/Task.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { validationResult } from 'express-validator';
import ExcelJS from 'exceljs';
import { format, subDays, eachDayOfInterval, isSameDay } from 'date-fns';

// Helper function to update task progress and status
// Only marks 'completed' if subtasks are 100% AND the days cover the full duration
const updateTaskProgressAndStatus = (task) => {
    const allSubTasks = task.days.flatMap(day => day.subTasks);
    // Be careful with empty subtasks
    if (allSubTasks.length === 0) {
        task.progress = 0;
        task.status = 'pending';
        return;
    }

    const completedCount = allSubTasks.filter(st => st.status === 'completed').length;
    task.progress = Math.round((completedCount / allSubTasks.length) * 100);

    // Check if we have subtasks for the final day (or if start=end)
    const hasFinalDay = task.days.some(d => isSameDay(new Date(d.date), new Date(task.endDate)));

    if (task.progress === 100 && hasFinalDay) {
        task.status = 'completed';
    } else if (task.progress > 0) {
        task.status = 'in-progress';
    } else {
        task.status = 'pending';
    }
};

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
            subTaskDetails // OPTIONAL
        } = req.body;

        // Validate assigned user
        const user = await User.findById(assignedTo);
        if (!user) {
            return res.status(404).json({ message: 'Assigned user not found' });
        }

        // Company resolution
        let taskCompany = company;
        if (req.user.role === 'admin') {
            if (!user.company) {
                return res.status(400).json({ message: 'Assigned user has no company' });
            }
            taskCompany = user.company;
        } else if (!taskCompany) {
            taskCompany = req.user.company;
        }

        // Validate company
        if (taskCompany) {
            const companyExists = await Company.findById(taskCompany);
            if (!companyExists) {
                return res.status(404).json({ message: 'Company not found' });
            }
        }

        const task = await Task.create({
            title,
            description,
            company: taskCompany,
            assignedTo,
            assignedBy: req.user.id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            priority: priority || 'medium',
            subTasks: []
        });

        // ✅ ONLY create subtasks if explicitly provided
        if (Array.isArray(subTaskDetails) && subTaskDetails.length > 0) {
            const subTasks = subTaskDetails.map((subTask) => ({
                date: new Date(subTask.date),
                description: subTask.description,
                status: 'pending',
                hoursSpent: 0,
                remarks: ''
            }));

            task.subTasks.push(...subTasks);
            await task.save();
        }

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

        // If assignedTo changed, get the user and company
        let taskCompany = task.company;
        if (assignedTo) {
            const user = await User.findById(assignedTo);
            if (!user) return res.status(404).json({ message: 'Assigned user not found' });

            if (req.user.role === 'admin') {
                if (!user.company) {
                    return res.status(400).json({ message: 'Assigned user does not belong to a company' });
                }
                taskCompany = user.company;
            }
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
                company: taskCompany,
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

export const addSubTaskDay = async (req, res) => {
    try {
        const { taskId } = req.params;
        // console.log(" taskId ", taskId);

        const { date, description, hoursSpent, remarks, status } = req.body;

        if (!date || !description) {
            return res.status(400).json({ message: 'Date and description are required' });
        }

        const task = await Task.findById(taskId);
        // console.log("task ", task);

        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Normalize date (strip time)
        const dayDate = new Date(date);
        dayDate.setHours(0, 0, 0, 0);

        // Ensure days exists
        if (!Array.isArray(task.days)) {
            task.days = [];
        }

        // Find day
        let day = task.days.find(d =>
            new Date(d.date).getTime() === dayDate.getTime()
        );

        // Create day if not exists
        if (!day) {
            task.days.push({
                date: dayDate,
                subTasks: []
            });
            day = task.days[task.days.length - 1];
        }
        if (!Array.isArray(day.subTasks)) {
            day.subTasks = [];
        }

        // Add subtask
        day.subTasks.push({
            description,
            hoursSpent: hoursSpent || 0,
            remarks: remarks || '',
            status: status || 'in-progress'
        });

        // Update progress and status centrally
        updateTaskProgressAndStatus(task);

        await task.save();

        res.status(201).json({
            success: true,
            message: 'Subtask added successfully',
            task
        });

    } catch (error) {
        console.error('ADD SUBTASK ERROR:', error);
        res.status(500).json({ message: error.message });
    }
};


export const deleteSubtask = async (req, res) => {
    try {
        const { taskId, subTaskId } = req.params;

        if (!req.user) return res.status(401).json({ message: 'Not authorized' });

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        let removed = false;

        for (let day of task.days) {
            const originalLength = day.subTasks.length;
            day.subTasks = day.subTasks.filter(st => st._id.toString() !== subTaskId);
            if (day.subTasks.length !== originalLength) {
                removed = true;
                break; // Subtask removed, no need to continue
            }
        }

        if (!removed) return res.status(404).json({ message: 'Subtask not found' });

        // Recalculate task progress
        updateTaskProgressAndStatus(task);

        await task.save();

        res.json({ success: true, message: 'Subtask deleted successfully', task });
    } catch (error) {
        console.error('DELETE SUBTASK ERROR:', error);
        res.status(500).json({ message: error.message });
    }
};


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

        // Find tasks
        const tasks = await Task.find(query)
            .populate('assignedTo', 'name email role')
            .populate('company', 'name');

        // Filter days and subtasks by month
        const monthlyReport = [];

        tasks.forEach(task => {
            const days = task.days || [];

            // Filter days within the month
            const monthlyDays = days.filter(day => {
                const dayDate = new Date(day.date);
                return dayDate >= startDate && dayDate <= endDate;
            });

            if (monthlyDays.length > 0) {
                // Collect all subtasks from filtered days
                const allSubTasks = [];
                let totalHours = 0;
                let completedCount = 0;
                let totalCount = 0;

                monthlyDays.forEach(day => {
                    const subTasks = day.subTasks || [];
                    subTasks.forEach(subTask => {
                        totalCount++;
                        totalHours += subTask.hoursSpent || 0;
                        if (subTask.status === 'completed') {
                            completedCount++;
                        }

                        allSubTasks.push({
                            date: day.date,
                            description: subTask.description,
                            status: subTask.status,
                            hoursSpent: subTask.hoursSpent || 0,
                            remarks: subTask.remarks || '',
                            completedAt: subTask.completedAt,
                            createdAt: subTask.createdAt
                        });
                    });
                });

                if (allSubTasks.length > 0) {
                    monthlyReport.push({
                        taskId: task._id,
                        taskTitle: task.title,
                        assignedTo: task.assignedTo?.name,
                        company: task.company?.name,
                        subTasks: allSubTasks,
                        totalHours,
                        completedSubtasks: completedCount,
                        totalSubtasks: totalCount
                    });
                }
            }
        });

        // Calculate summary
        const summary = {
            totalTasks: monthlyReport.length,
            totalSubtasks: monthlyReport.reduce((sum, task) => sum + task.totalSubtasks, 0),
            completedSubtasks: monthlyReport.reduce((sum, task) => sum + task.completedSubtasks, 0),
            totalHours: monthlyReport.reduce((sum, task) => sum + task.totalHours, 0),
            completionRate: 0
        };

        // Calculate completion rate safely
        if (summary.totalSubtasks > 0) {
            summary.completionRate = Math.round((summary.completedSubtasks / summary.totalSubtasks) * 100);
        }

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
        console.error('Subtask report error:', error);
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
        const { id } = req.params; // Get task ID from URL params

        const task = await Task.findById(id)
            .populate('assignedTo', 'name email role')
            .populate('assignedBy', 'name email')
            .populate('company', 'name');

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Check permission
        if (req.user.role === 'staff' && task.assignedTo._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this task'
            });
        }

        // Manager can only see tasks from their company
        if (req.user.role === 'manager' && task.company._id.toString() !== req.user.company.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this task'
            });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        console.error('Error in getTask:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const updateSubTask = async (req, res) => {
    try {
        const { taskId, subTaskId } = req.params;
        const { status, hoursSpent, remarks, description } = req.body;

        if (!req.user) return res.status(401).json({ message: 'Not authorized' });

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        // Permission check
        if (req.user.role === 'staff' && task.assignedTo.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this task' });
        }

        // Find subtask in days
        let subTaskFound = null;
        for (let day of task.days) {
            const subTask = day.subTasks.id(subTaskId);
            if (subTask) {
                subTaskFound = subTask;
                break;
            }
        }

        if (!subTaskFound) return res.status(404).json({ message: 'Subtask not found' });

        // Update fields
        subTaskFound.description = description || subTaskFound.description;
        subTaskFound.status = status || subTaskFound.status;
        subTaskFound.hoursSpent = hoursSpent ?? subTaskFound.hoursSpent;
        subTaskFound.remarks = remarks ?? subTaskFound.remarks;

        if (status === 'completed' && subTaskFound.status !== 'completed') {
            subTaskFound.completedAt = new Date();
        }

        // Recalculate task progress
        updateTaskProgressAndStatus(task);

        await task.save();

        const updatedTask = await Task.findById(taskId)
            .populate('assignedTo', 'name email')
            .populate('assignedBy', 'name email')
            .populate('company', 'name');

        res.json({ success: true, task: updatedTask });
    } catch (error) {
        console.error('UPDATE SUBTASK ERROR:', error);
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
// ✅ FIXED GET REPORT - Works with days[] structure
// ✅ FIXED GET REPORT - Works with days[] structure AND includes complete tree
// ✅ FIXED GET REPORT - Works with days[] structure AND includes complete tree
export const getReport = async (req, res) => {
    try {
        const {
            month = new Date().getMonth() + 1,
            year = new Date().getFullYear(),
            userId,
            companyId,
            role
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

        // Apply role filter (if role is provided and no specific user selected)
        if (role && !userId) {
            const userQuery = { role };

            // If manager is requesting, scope to their company
            if (req.user.role === 'manager') {
                userQuery.company = req.user.company;
            }
            // If staff is requesting, they probably shouldn't be filtering freely, 
            // but the role check below handles their restriction to self.

            const users = await User.find(userQuery).select('_id');
            const userIds = users.map(u => u._id);
            query.assignedTo = { $in: userIds };
        }

        // Apply role-based filtering (Constraint)
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

        // Helper function to calculate day completion based on subtasks
        const getDayCompletionStatus = (day) => {
            const subTasks = day.subTasks || [];

            if (subTasks.length === 0) {
                return 'pending'; // No subtasks for this day
            }

            const allCompleted = subTasks.every(st => st.status === 'completed');
            const anyInProgress = subTasks.some(st =>
                st.status === 'in-progress' || st.status === 'pending'
            );

            if (allCompleted) {
                return 'completed';
            } else if (anyInProgress || subTasks.length > 0) {
                return 'in-progress';
            }

            return 'pending';
        };

        // Helper function to calculate totals from days array with daily status
        const calculateTaskStats = (task) => {
            const days = task.days || [];
            let totalHours = 0;
            let completedSubtasks = 0;
            let totalSubtasks = 0;

            // Create a map of existing days for quick lookup
            const existingDaysMap = new Map();
            days.forEach(day => {
                const dayDate = new Date(day.date);
                dayDate.setHours(0, 0, 0, 0);
                const dayKey = dayDate.getTime();
                existingDaysMap.set(dayKey, day);
            });

            // Generate all days in the month that fall within task date range
            const allDaysInMonth = [];
            const taskStart = new Date(task.startDate);
            const taskEnd = new Date(task.endDate);
            taskStart.setHours(0, 0, 0, 0);
            taskEnd.setHours(23, 59, 59, 999);

            // Get the number of days in the month
            const daysInMonth = endDate.getDate();

            // Iterate through each day of the month
            for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
                const currentDay = new Date(year, month - 1, dayNum);
                currentDay.setHours(0, 0, 0, 0);

                // Only include days within task date range
                if (currentDay >= taskStart && currentDay <= taskEnd) {
                    const dayKey = currentDay.getTime();
                    const existingDay = existingDaysMap.get(dayKey);

                    if (existingDay) {
                        // Day has work data
                        const subTasks = existingDay.subTasks || [];
                        let dayHours = 0;
                        let dayCompletedSubtasks = 0;
                        let dayTotalSubtasks = subTasks.length;

                        subTasks.forEach(subTask => {
                            dayHours += subTask.hoursSpent || 0;
                            if (subTask.status === 'completed') {
                                dayCompletedSubtasks++;
                                completedSubtasks++;
                            }
                        });

                        totalHours += dayHours;
                        totalSubtasks += dayTotalSubtasks;

                        allDaysInMonth.push({
                            date: currentDay,
                            subTasks: subTasks,
                            totalHours: dayHours,
                            completedSubtasks: dayCompletedSubtasks,
                            totalSubtasks: dayTotalSubtasks,
                            status: getDayCompletionStatus(existingDay) // Daily completion status
                        });
                    } else {
                        // Day has no work - mark as pending
                        allDaysInMonth.push({
                            date: currentDay,
                            subTasks: [],
                            totalHours: 0,
                            completedSubtasks: 0,
                            totalSubtasks: 0,
                            status: 'pending' // No work done on this day
                        });
                    }
                }
            }

            return {
                totalHours,
                completedSubtasks,
                totalSubtasks,
                daysWithStatus: allDaysInMonth
            };
        };

        // Generate report data WITH COMPLETE TREE STRUCTURE
        const reportData = tasks.map(task => {
            const stats = calculateTaskStats(task);

            return {
                _id: task._id,
                taskId: task._id,
                title: task.title,
                description: task.description,
                assignedTo: {
                    _id: task.assignedTo?._id,
                    name: task.assignedTo?.name,
                    email: task.assignedTo?.email,
                    role: task.assignedTo?.role
                },
                assignedBy: {
                    _id: task.assignedBy?._id,
                    name: task.assignedBy?.name,
                    email: task.assignedBy?.email
                },
                company: {
                    _id: task.company?._id,
                    name: task.company?.name
                },
                startDate: task.startDate,
                endDate: task.endDate,
                status: task.status,
                priority: task.priority,
                progress: task.progress,
                totalHours: stats.totalHours,
                completedSubtasks: stats.completedSubtasks,
                totalSubtasks: stats.totalSubtasks,
                createdAt: task.createdAt,
                // 🔥 INCLUDE COMPLETE TREE STRUCTURE WITH DAILY STATUS
                days: stats.daysWithStatus.map(day => ({
                    date: day.date,
                    status: day.status, // Daily completion status
                    totalHours: day.totalHours,
                    completedSubtasks: day.completedSubtasks,
                    totalSubtasks: day.totalSubtasks,
                    subTasks: (day.subTasks || []).map(subTask => ({
                        _id: subTask._id,
                        description: subTask.description,
                        hoursSpent: subTask.hoursSpent || 0,
                        remarks: subTask.remarks || '',
                        status: subTask.status,
                        completedAt: subTask.completedAt,
                        createdAt: subTask.createdAt,
                        updatedAt: subTask.updatedAt
                    }))
                }))
            };
        });

        // Calculate summary statistics
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => t.status === 'completed').length;
        const pendingTasks = tasks.filter(t => t.status === 'pending').length;
        const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
        const totalHours = reportData.reduce((sum, task) => sum + task.totalHours, 0);
        const avgProgress = totalTasks > 0 ?
            Math.round(reportData.reduce((sum, task) => sum + task.progress, 0) / totalTasks) : 0;

        // Calculate daily completion stats
        let completedDays = 0;
        let inProgressDays = 0;
        let pendingDays = 0;

        reportData.forEach(task => {
            task.days.forEach(day => {
                if (day.status === 'completed') completedDays++;
                else if (day.status === 'in-progress') inProgressDays++;
                else if (day.status === 'pending') pendingDays++;
            });
        });

        // Group by user for detailed analysis
        const userReports = {};
        reportData.forEach(task => {
            const userName = task.assignedTo?.name;
            if (!userReports[userName]) {
                userReports[userName] = {
                    name: userName,
                    email: task.assignedTo?.email,
                    totalTasks: 0,
                    completedTasks: 0,
                    totalHours: 0,
                    avgProgress: 0,
                    completedDays: 0,
                    inProgressDays: 0,
                    pendingDays: 0
                };
            }
            userReports[userName].totalTasks++;
            userReports[userName].totalHours += task.totalHours;

            // Count days by status for each user
            task.days.forEach(day => {
                if (day.status === 'completed') userReports[userName].completedDays++;
                else if (day.status === 'in-progress') userReports[userName].inProgressDays++;
                else if (day.status === 'pending') userReports[userName].pendingDays++;
            });

            if (task.status === 'completed') {
                userReports[userName].completedTasks++;
            }
        });

        // Calculate average progress per user
        Object.keys(userReports).forEach(userName => {
            const userTasks = reportData.filter(task => task.assignedTo?.name === userName);
            userReports[userName].avgProgress = userTasks.length > 0 ?
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
                    completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
                    completedDays,
                    inProgressDays,
                    pendingDays
                },
                detailed: reportData, // 🔥 NOW INCLUDES COMPLETE TREE WITH DAILY STATUS
                userReports: Object.values(userReports),
                chartData: [
                    { name: 'Completed', value: completedTasks, color: '#4CAF50' },
                    { name: 'In Progress', value: inProgressTasks, color: '#2196F3' },
                    { name: 'Pending', value: pendingTasks, color: '#FF9800' }
                ]
            }
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ message: error.message });
    }
};

// ✅ FIXED EXPORT TO EXCEL - Works with days[] structure
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

        // Helper function to calculate totals from days array
        const calculateTaskStats = (task) => {
            const days = task.days || [];
            let totalHours = 0;
            let completedSubtasks = 0;
            let totalSubtasks = 0;

            days.forEach(day => {
                const subTasks = day.subTasks || [];
                totalSubtasks += subTasks.length;
                subTasks.forEach(subTask => {
                    totalHours += subTask.hoursSpent || 0;
                    if (subTask.status === 'completed') {
                        completedSubtasks++;
                    }
                });
            });

            return { totalHours, completedSubtasks, totalSubtasks };
        };

        // Create workbook and worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Tasks Report');

        // Define columns
        worksheet.columns = [
            { header: 'SR #', key: 'srNo', width: 10 },
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
            const stats = calculateTaskStats(task);

            worksheet.addRow({
                srNo: index + 1,
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
                totalHours: stats.totalHours,
                completedSubtasks: stats.completedSubtasks,
                totalSubtasks: stats.totalSubtasks,
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
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
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

