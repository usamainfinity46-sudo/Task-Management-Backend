import mongoose from 'mongoose';
import Task from '../models/Task.js';
import User from '../models/User.js';
import Company from '../models/Company.js';

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/dashboard/stats
 * @access  Private
 */


export const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    // ===============================
    // STAFF: ONLY THEIR TASKS
    // ADMIN: ALL TASKS
    // ===============================
    let taskQuery = {};

    if (userRole !== 'admin') {
      taskQuery = {
        $or: [
          { assignedTo: userId },
          { 'days.subTasks.assignedTo': userId }
        ]
      };
    }

    // ===============================
    // TASK COUNTS (DIRECT TASKS ONLY)
    // ===============================
    const totalTasks = await Task.countDocuments(
      userRole === 'admin' ? {} : { assignedTo: userId }
    );

    const completedTasks = await Task.countDocuments({
      ...(userRole === 'admin' ? {} : { assignedTo: userId }),
      status: 'completed'
    });

    const pendingTasks = await Task.countDocuments({
      ...(userRole === 'admin' ? {} : { assignedTo: userId }),
      status: 'pending'
    });

    const inProgressTasks = await Task.countDocuments({
      ...(userRole === 'admin' ? {} : { assignedTo: userId }),
      status: 'in-progress'
    });

    const delayedTasks = await Task.countDocuments({
      ...(userRole === 'admin' ? {} : { assignedTo: userId }),
      status: 'delayed'
    });

    // ===============================
    // SUBTASK COUNTS (FOR TASKS ASSIGNED TO USER)
    // ===============================
    let subtaskStats = {
      total: 0,
      completed: 0,
      pending: 0,
      inProgress: 0,
      delayed: 0
    };

    if (userRole !== 'admin') {
      // Get subtasks from tasks where the user is the main assignee
      const subTaskAggregation = await Task.aggregate([
        // Only get tasks assigned to this user
        { $match: { assignedTo: userId } },
        { $unwind: '$days' },
        { $unwind: '$days.subTasks' },
        {
          $group: {
            _id: '$days.subTasks.status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Initialize all counts to 0
      subtaskStats = {
        total: 0,
        completed: 0,
        pending: 0,
        inProgress: 0,
        delayed: 0
      };

      // Sum up all subtask counts
      subTaskAggregation.forEach(item => {
        if (item._id === 'completed') subtaskStats.completed = item.count;
        else if (item._id === 'pending') subtaskStats.pending = item.count;
        else if (item._id === 'in-progress') subtaskStats.inProgress = item.count;
        else if (item._id === 'delayed') subtaskStats.delayed = item.count;
        
        subtaskStats.total += item.count;
      });
    } else {
      // For admin: get subtasks from ALL tasks
      const subTaskAggregation = await Task.aggregate([
        { $unwind: '$days' },
        { $unwind: '$days.subTasks' },
        {
          $group: {
            _id: '$days.subTasks.status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Initialize all counts to 0
      subtaskStats = {
        total: 0,
        completed: 0,
        pending: 0,
        inProgress: 0,
        delayed: 0
      };

      // Sum up all subtask counts
      subTaskAggregation.forEach(item => {
        if (item._id === 'completed') subtaskStats.completed = item.count;
        else if (item._id === 'pending') subtaskStats.pending = item.count;
        else if (item._id === 'in-progress') subtaskStats.inProgress = item.count;
        else if (item._id === 'delayed') subtaskStats.delayed = item.count;
        
        subtaskStats.total += item.count;
      });
    }

    // ===============================
    // CHART DATA (LAST 7 DAYS)
    // ===============================
    const days = [];
    const today = new Date();

    // Initialize last 7 days with 0 counts
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      days.push({
        date: date,
        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateStr: date.toISOString().split('T')[0],
        completed: 0,
        pending: 0,
        inProgress: 0,
        delayed: 0
      });
    }

    const last7DaysDate = new Date(today);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);

    // Build base query for user's tasks
    let chartTaskQuery = {};
    if (userRole !== 'admin') {
      chartTaskQuery = {
        $or: [
          { assignedTo: userId },
          { 'days.subTasks.assignedTo': userId }
        ]
      };
    }

    // Fetch tasks updated in the last 7 days
    const weeklyTasks = await Task.find({
      ...chartTaskQuery,
      updatedAt: { $gte: last7DaysDate }
    }).lean();

    // Populate counts for chart data
    weeklyTasks.forEach(task => {
      const taskDate = new Date(task.updatedAt).toISOString().split('T')[0];
      const dayStat = days.find(d => d.dateStr === taskDate);

      if (dayStat) {
        // Count main task
        if (task.status === 'completed') dayStat.completed++;
        else if (task.status === 'pending') dayStat.pending++;
        else if (task.status === 'in-progress') dayStat.inProgress++;
        else if (task.status === 'delayed') dayStat.delayed++;
      }

      // Also count subtasks if they belong to this user
      if (task.days) {
        task.days.forEach(day => {
          if (day.subTasks) {
            day.subTasks.forEach(subtask => {
              // Only count subtasks assigned to this user (or all for admin)
              if (userRole === 'admin' || subtask.assignedTo?.toString() === userId.toString()) {
                const subtaskDate = new Date(subtask.updatedAt || subtask.createdAt || task.updatedAt)
                  .toISOString()
                  .split('T')[0];
                const subtaskDayStat = days.find(d => d.dateStr === subtaskDate);
                
                if (subtaskDayStat) {
                  if (subtask.status === 'completed') subtaskDayStat.completed++;
                  else if (subtask.status === 'pending') subtaskDayStat.pending++;
                  else if (subtask.status === 'in-progress') subtaskDayStat.inProgress++;
                  else if (subtask.status === 'delayed') subtaskDayStat.delayed++;
                }
              }
            });
          }
        });
      }
    });

    // Format chart data for frontend (just what the chart needs)
    const chartData = days.map(({ name, completed, pending, inProgress, delayed }) => ({
      name,
      completed,
      pending,
      inProgress,
      delayed
    }));

    // ===============================
    // RECENT TASKS + FILTER SUBTASKS
    // ===============================
    const recentTasks = await Task.find(taskQuery)
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name')
      .populate('company', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Filter recent tasks to only show subtasks assigned to this user
    const filteredRecentTasks = recentTasks.map(task => {
      const taskObj = { ...task };
      
      // If staff user, filter subtasks to show only those assigned to them
      if (userRole !== 'admin' && taskObj.days) {
        taskObj.days = taskObj.days.map(day => {
          if (day.subTasks) {
            // Filter subtasks to only show those assigned to this user
            day.subTasks = day.subTasks.filter(
              subtask => subtask.assignedTo?.toString() === userId.toString()
            );
          }
          return day;
        }).filter(day => day.subTasks && day.subTasks.length > 0);
      }
      
      return taskObj;
    });

    // ===============================
    // PRODUCTIVITY
    // ===============================
    const totalWork = totalTasks + subtaskStats.total;
    const completedWork = completedTasks + subtaskStats.completed;

    const productivity = totalWork > 0
      ? Math.round((completedWork / totalWork) * 100)
      : 0;

    // ===============================
    // RESPONSE
    // ===============================
    res.json({
      success: true,
      data: {
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          pending: pendingTasks,
          inProgress: inProgressTasks,
          delayed: delayedTasks
        },
        subtasks: subtaskStats,
        summary: {
          totalWork,
          completedWork,
          productivity
        },
        chartData, // <-- Added chartData here
        recentTasks: filteredRecentTasks
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Get user-specific dashboard with comprehensive activity tracking
 * @route   GET /api/dashboard/user
 * @access  Private
 */
export const getUserDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    // Get tasks assigned to user
    const userTasks = await Task.find({ assignedTo: userId })
      .populate('assignedBy', 'name')
      .populate('company', 'name')
      .sort({ createdAt: -1 });

    // Count tasks by status
    const taskCounts = {
      total: userTasks.length,
      completed: userTasks.filter(t => t.status === 'completed').length,
      pending: userTasks.filter(t => t.status === 'pending').length,
      inProgress: userTasks.filter(t => t.status === 'in-progress').length,
      delayed: userTasks.filter(t => t.status === 'delayed').length
    };

    // Calculate user productivity - FIXED for days.subTasks structure
    const completedSubTasks = userTasks.reduce((acc, task) => {
      const taskSubtasks = (task.days || []).flatMap(day => day.subTasks || []);
      return acc + taskSubtasks.filter(st => st.status === 'completed').length;
    }, 0);

    const totalSubTasks = userTasks.reduce((acc, task) => {
      const taskSubtasks = (task.days || []).flatMap(day => day.subTasks || []);
      return acc + taskSubtasks.length;
    }, 0);

    const productivity = totalSubTasks > 0
      ? Math.round((completedSubTasks / totalSubTasks) * 100)
      : 0;

    // Get upcoming deadlines (tasks due in next 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcomingDeadlines = await Task.find({
      assignedTo: userId,
      endDate: { $lte: sevenDaysFromNow, $gte: new Date() },
      status: { $in: ['pending', 'in-progress'] }
    })
      .populate('company', 'name')
      .sort({ endDate: 1 })
      .limit(5);

    // ===============================
    // COMPREHENSIVE RECENT ACTIVITY
    // ===============================
    const recentActivity = [];

    // 1. Tasks assigned TO the user
    const tasksAssignedToUser = await Task.find({
      assignedTo: userId
    })
      .populate('assignedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    tasksAssignedToUser.forEach(task => {
      const assignerName = task.assignedBy ? task.assignedBy.name : 'Someone';
      recentActivity.push({
        type: 'task_assigned',
        description: `${assignerName} assigned task: ${task.title}`,
        task: task.title,
        status: task.status,
        progress: task.progress,
        timestamp: task.createdAt
      });
    });

    // 2. Tasks assigned BY the user (if they can assign tasks)
    const tasksAssignedByUser = await Task.find({
      assignedBy: userId
    })
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    tasksAssignedByUser.forEach(task => {
      const assigneeName = task.assignedTo ? task.assignedTo.name : 'Someone';
      recentActivity.push({
        type: 'task_created',
        description: `You assigned task: ${task.title} to ${assigneeName}`,
        task: task.title,
        status: task.status,
        progress: task.progress,
        timestamp: task.createdAt
      });
    });

    // 3. Task updates where user is involved
    const updatedTasks = await Task.aggregate([
      {
        $match: {
          $or: [
            { assignedTo: userId },
            { assignedBy: userId }
          ],
          $expr: { $ne: ['$updatedAt', '$createdAt'] }
        }
      },
      { $sort: { updatedAt: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedTo',
          foreignField: '_id',
          as: 'assignedToUser'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedBy',
          foreignField: '_id',
          as: 'assignedByUser'
        }
      },
      {
        $addFields: {
          assignedTo: { $arrayElemAt: ['$assignedToUser', 0] },
          assignedBy: { $arrayElemAt: ['$assignedByUser', 0] }
        }
      },
      {
        $project: {
          assignedToUser: 0,
          assignedByUser: 0
        }
      }
    ]);

    updatedTasks.forEach(task => {
      let action = 'updated';
      let type = 'task_updated';

      if (task.status === 'completed') {
        action = 'completed';
        type = 'task_completed';
      } else if (task.status === 'delayed') {
        action = 'marked as delayed';
        type = 'task_delayed';
      } else if (task.status === 'in-progress') {
        action = 'started working on';
        type = 'task_updated';
      }

      const actor = task.assignedTo?._id.toString() === userId.toString()
        ? 'You'
        : task.assignedTo?.name || 'Someone';

      recentActivity.push({
        type,
        description: `${actor} ${action} task: ${task.title}`,
        task: task.title,
        status: task.status,
        progress: task.progress,
        timestamp: task.updatedAt
      });
    });

    // 4. Subtasks assigned to the user - FIXED for days.subTasks structure
    const tasksWithSubtasks = await Task.find({
      'days.subTasks.assignedTo': userId
    })
      .populate('assignedBy', 'name')
      .sort({ 'createdAt': -1 })
      .limit(20)
      .lean();

    tasksWithSubtasks.forEach(task => {
      // Get all subtasks assigned to this user from all days
      const userSubtasks = (task.days || []).flatMap(day => 
        (day.subTasks || []).filter(
          st => st.assignedTo?.toString() === userId.toString()
        )
      );

      userSubtasks.forEach(subtask => {
        const assignerName = task.assignedBy?.name || 'Someone';
        recentActivity.push({
          type: 'subtask_assigned',
          description: `${assignerName} assigned subtask: ${subtask.description} (in ${task.title})`,
          task: `${task.title} - ${subtask.description}`,
          status: subtask.status,
          progress: 0,
          timestamp: subtask.createdAt || task.createdAt
        });
      });
    });

    // 5. Subtask updates by the user - FIXED for days.subTasks structure
    const updatedSubtasks = await Task.find({
      'days.subTasks.assignedTo': userId,
      'days.subTasks.updatedAt': { $exists: true }
    })
      .sort({ 'updatedAt': -1 })
      .limit(20)
      .lean();

    updatedSubtasks.forEach(task => {
      // Find subtasks assigned to this user that have been updated
      const userSubtasks = (task.days || []).flatMap(day => 
        (day.subTasks || []).filter(
          st => st.assignedTo?.toString() === userId.toString() && st.updatedAt
        )
      );

      userSubtasks.forEach(subtask => {
        let action = 'updated';
        let type = 'subtask_updated';

        if (subtask.status === 'completed') {
          action = 'completed';
          type = 'subtask_completed';
        } else if (subtask.status === 'delayed') {
          action = 'marked as delayed';
          type = 'subtask_delayed';
        }

        recentActivity.push({
          type,
          description: `You ${action} subtask: ${subtask.description} (in ${task.title})`,
          task: `${task.title} - ${subtask.description}`,
          status: subtask.status,
          progress: 0,
          timestamp: subtask.updatedAt || subtask.createdAt || task.updatedAt
        });
      });
    });

    // 6. Users added by this user (if they have permission)
    if (['admin', 'manager'].includes(userRole)) {
      const usersAddedByUser = await User.find({
        createdBy: userId
      })
        .sort({ createdAt: -1 })
        .limit(15)
        .lean();

      usersAddedByUser.forEach(user => {
        recentActivity.push({
          type: 'user_added',
          description: `You added user: ${user.name} (${user.email})`,
          task: user.name,
          status: user.isActive ? 'active' : 'inactive',
          progress: 0,
          timestamp: user.createdAt
        });
      });
    }

    // 7. Users assigned to this manager
    const managedUsers = await User.find({
      manager: userId
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    managedUsers.forEach(user => {
      recentActivity.push({
        type: 'user_assigned',
        description: `${user.name} was assigned to your team`,
        task: user.name,
        status: user.isActive ? 'active' : 'inactive',
        progress: 0,
        timestamp: user.createdAt
      });
    });

    // Sort all activities by timestamp and limit to 50 most recent
    const sortedActivity = recentActivity
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 50);

    // ===============================
    // CHART DATA (LAST 7 DAYS)
    // ===============================
    const days = [];
    const today = new Date();

    // Initialize last 7 days with 0 counts
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      days.push({
        date: date,
        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateStr: date.toISOString().split('T')[0],
        completed: 0,
        pending: 0,
        inProgress: 0,
        delayed: 0
      });
    }

    const last7DaysDate = new Date(today);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);

    // Fetch tasks updated in the last 7 days
    const weeklyStats = await Task.find({
      $or: [
        { assignedTo: userId },
        { assignedBy: userId },
        { 'days.subTasks.assignedTo': userId }
      ],
      updatedAt: { $gte: last7DaysDate }
    }).select('status updatedAt');

    // Populate counts
    weeklyStats.forEach(task => {
      const taskDate = task.updatedAt.toISOString().split('T')[0];
      const dayStat = days.find(d => d.dateStr === taskDate);

      if (dayStat) {
        if (task.status === 'completed') dayStat.completed++;
        else if (task.status === 'pending') dayStat.pending++;
        else if (task.status === 'in-progress') dayStat.inProgress++;
        else if (task.status === 'delayed') dayStat.delayed++;
      }
    });

    // Format for frontend
    const chartData = days.map(({ name, completed, pending, inProgress, delayed }) => ({
      name,
      completed,
      pending,
      inProgress,
      delayed
    }));

    res.json({
      success: true,
      data: {
        taskCounts,
        productivity,
        upcomingDeadlines,
        recentActivity: sortedActivity,
        chartData,
        userTasks: userTasks.slice(0, 5)
      }
    });

  } catch (error) {
    console.error('User dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get manager dashboard
 * @route   GET /api/dashboard/manager
 * @access  Private (Manager+)
 */
export const getManagerDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    const companyId = req.user.company;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'User is not associated with any company'
      });
    }

    // Get all team members in the company
    const teamMembers = await User.find({
      company: companyId,
      isActive: true
    }).select('name email role');

    // Get tasks for the entire company
    const companyTasks = await Task.find({ company: companyId })
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name')
      .sort({ createdAt: -1 });

    // Calculate team statistics
    const teamStats = {
      totalMembers: teamMembers.length,
      activeMembers: teamMembers.filter(m => m.isActive).length,
      totalTasks: companyTasks.length,
      completedTasks: companyTasks.filter(t => t.status === 'completed').length,
      pendingTasks: companyTasks.filter(t => t.status === 'pending').length,
      inProgressTasks: companyTasks.filter(t => t.status === 'in-progress').length,
      delayedTasks: companyTasks.filter(t => t.status === 'delayed').length
    };

    // Calculate team productivity
    teamStats.productivity = teamStats.totalTasks > 0
      ? Math.round((teamStats.completedTasks / teamStats.totalTasks) * 100)
      : 0;

    // Get task distribution by team member
    const taskDistribution = await Task.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$assignedTo',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          userName: '$user.name',
          userEmail: '$user.email',
          totalTasks: 1,
          completedTasks: 1,
          pendingTasks: 1,
          completionRate: {
            $multiply: [
              { $divide: ['$completedTasks', { $max: ['$totalTasks', 1] }] },
              100
            ]
          }
        }
      }
    ]);

    // Get tasks created by manager
    const managerTasks = await Task.find({
      assignedBy: userId,
      company: companyId
    })
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        teamStats,
        taskDistribution,
        teamMembers,
        managerTasks,
        companyTasks: companyTasks.slice(0, 10)
      }
    });

  } catch (error) {
    console.error('Manager dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching manager dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get admin dashboard
 * @route   GET /api/dashboard/admin
 * @access  Private (Admin only)
 */
export const getAdminDashboard = async (req, res) => {
  try {
    // Get overall statistics
    const totalUsers = await User.countDocuments({ isActive: true });
    const totalCompanies = await Company.countDocuments({ isActive: true });
    const totalTasks = await Task.countDocuments();

    // Get tasks by status
    const tasksByStatus = await Task.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get companies with task counts
    const companiesWithStats = await Company.aggregate([
      {
        $lookup: {
          from: 'tasks',
          localField: '_id',
          foreignField: 'company',
          as: 'tasks'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'company',
          as: 'users'
        }
      },
      {
        $project: {
          name: 1,
          taskCount: { $size: '$tasks' },
          userCount: { $size: { $filter: { input: '$users', as: 'user', cond: { $eq: ['$$user.isActive', true] } } } },
          completedTasks: {
            $size: {
              $filter: {
                input: '$tasks',
                as: 'task',
                cond: { $eq: ['$$task.status', 'completed'] }
              }
            }
          }
        }
      },
      { $sort: { taskCount: -1 } }
    ]);

    // Get recent system activity
    const recentSystemActivity = await Task.aggregate([
      { $sort: { updatedAt: -1 } },
      { $limit: 15 },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedTo',
          foreignField: '_id',
          as: 'assignedToUser'
        }
      },
      { $unwind: '$assignedToUser' },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedBy',
          foreignField: '_id',
          as: 'assignedByUser'
        }
      },
      { $unwind: '$assignedByUser' },
      {
        $project: {
          type: { $literal: 'task_activity' },
          description: {
            $concat: [
              '$assignedByUser.name',
              ' assigned "',
              '$title',
              '" to ',
              '$assignedToUser.name'
            ]
          },
          timestamp: '$updatedAt',
          status: '$status'
        }
      }
    ]);

    // Get monthly growth data
    const monthlyGrowth = await getMonthlyGrowthData();

    res.json({
      success: true,
      data: {
        totalUsers,
        totalCompanies,
        totalTasks,
        tasksByStatus,
        companiesWithStats,
        recentSystemActivity,
        monthlyGrowth,
        overview: {
          activeUsers: totalUsers,
          activeCompanies: totalCompanies,
          activeTasks: totalTasks,
          taskCompletionRate: (tasksByStatus.find(s => s._id === 'completed')?.count || 0) / totalTasks * 100 || 0
        }
      }
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admin dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function
async function getMonthlyGrowthData() {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const startDate = new Date(currentYear, currentMonth - 5, 1);
  const endDate = new Date(currentYear, currentMonth + 1, 0);

  const monthlyData = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          month: { $month: "$createdAt" },
          year: { $year: "$createdAt" }
        },
        count: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
        }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);

  return monthlyData.map(item => ({
    month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
    tasks: item.count,
    completed: item.completed,
    growth: 0
  }));
}