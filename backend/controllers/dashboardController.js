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
          { 'subtasks.assignedTo': userId }
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
    // SUBTASK COUNTS (STAFF ONLY)
    // ===============================
    let subtaskStats = {
      total: 0,
      completed: 0,
      pending: 0,
      inProgress: 0,
      delayed: 0
    };

    if (userRole !== 'admin') {
      const subTaskAggregation = await Task.aggregate([
        { $unwind: '$subtasks' },
        {
          $match: {
            'subtasks.assignedTo': userId
          }
        },
        {
          $group: {
            _id: '$subtasks.status',
            count: { $sum: 1 }
          }
        }
      ]);

      subTaskAggregation.forEach(item => {
        subtaskStats.total += item.count;

        if (item._id === 'completed') subtaskStats.completed = item.count;
        if (item._id === 'pending') subtaskStats.pending = item.count;
        if (item._id === 'in-progress') subtaskStats.inProgress = item.count;
        if (item._id === 'delayed') subtaskStats.delayed = item.count;
      });
    }

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

    // Show ONLY subtasks assigned to staff
    if (userRole !== 'admin') {
      recentTasks.forEach(task => {
        task.subtasks = (task.subtasks || []).filter(
          st => st.assignedTo?.toString() === userId.toString()
        );
      });
    }

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
        recentTasks
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
 * @desc    Get user-specific dashboard
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
    
    // Calculate user productivity
    const completedSubTasks = userTasks.reduce((acc, task) => {
      return acc + (task.subTasks?.filter(st => st.status === 'completed').length || 0);
    }, 0);
    
    const totalSubTasks = userTasks.reduce((acc, task) => {
      return acc + (task.subTasks?.length || 0);
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
    
    // Get recent activity for user
    const recentActivity = await Task.aggregate([
      { $match: { assignedTo: new mongoose.Types.ObjectId(userId) } },
      { $sort: { updatedAt: -1 } },
      { $limit: 10 },
      {
        $project: {
          type: { $literal: 'task_updated' },
          description: '$title',
          task: '$title',
          status: '$status',
          progress: '$progress',
          timestamp: '$updatedAt'
        }
      }
    ]);
    
    // Add sample activities if no recent activity
    if (recentActivity.length === 0) {
      recentActivity.push(...generateSampleActivities());
    }
    
    res.json({
      success: true,
      data: {
        taskCounts,
        productivity,
        upcomingDeadlines,
        recentActivity,
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
    
    // Add sample activities if no recent activity
    if (recentSystemActivity.length === 0) {
      recentSystemActivity.push(...generateSampleActivities());
    }
    
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
          taskCompletionRate: tasksByStatus.find(s => s._id === 'completed')?.count || 0 / totalTasks * 100 || 0
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

// Helper functions

/**
 * Get recent activities for dashboard
 */
async function getRecentActivities(userId, userRole, query) {
  try {
    const recentTasks = await Task.find(query)
      .populate('assignedTo', 'name')
      .populate('assignedBy', 'name')
      .sort({ updatedAt: -1 })
      .limit(10);
    
    const activities = recentTasks.map(task => ({
      id: task._id,
      type: getActivityType(task),
      user: task.assignedBy?.name || 'System',
      task: task.title,
      target: task.assignedTo?.name,
      description: getActivityDescription(task),
      timestamp: task.updatedAt
    }));
    
    // Add user activities if available
    const recentUsers = await User.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5);
    
    const userActivities = recentUsers.map(user => ({
      id: user._id,
      type: 'user_added',
      user: 'Admin',
      target: user.name,
      timestamp: user.createdAt
    }));
    
    return [...activities, ...userActivities].slice(0, 10);
    
  } catch (error) {
    console.error('Error fetching activities:', error);
    return generateSampleActivities();
  }
}

/**
 * Get chart data for dashboard
 */
async function getChartData(query) {
  try {
    const today = new Date();
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);
    
    const chartData = await Task.aggregate([
      {
        $match: {
          ...query,
          updatedAt: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" }
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
          },
          inProgress: {
            $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] }
          },
          delayed: {
            $sum: { $cond: [{ $eq: ["$status", "delayed"] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          name: "$_id",
          completed: 1,
          pending: 1,
          inProgress: 1,
          delayed: 1,
          _id: 0
        }
      }
    ]);
    
    // Fill in missing days
    const filledData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existingData = chartData.find(d => d.name === dateStr);
      if (existingData) {
        filledData.push(existingData);
      } else {
        filledData.push({
          name: dateStr,
          completed: 0,
          pending: 0,
          inProgress: 0,
          delayed: 0
        });
      }
    }
    
    return filledData;
    
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return generateSampleChartData();
  }
}

/**
 * Get monthly growth data
 */
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
    growth: 0 // You can calculate growth percentage if needed
  }));
}

/**
 * Generate sample activities for testing
 */
function generateSampleActivities() {
  const now = new Date();
  return [
    {
      id: 1,
      type: 'task_completed',
      user: 'John Doe',
      task: 'Project Setup',
      timestamp: new Date(now.getTime() - 3600000).toISOString()
    },
    {
      id: 2,
      type: 'user_added',
      user: 'Admin',
      target: 'Jane Smith',
      timestamp: new Date(now.getTime() - 7200000).toISOString()
    },
    {
      id: 3,
      type: 'task_created',
      user: 'Manager',
      task: 'Dashboard Implementation',
      timestamp: new Date(now.getTime() - 10800000).toISOString()
    },
    {
      id: 4,
      type: 'task_delayed',
      task: 'API Integration',
      timestamp: new Date(now.getTime() - 14400000).toISOString()
    }
  ];
}

/**
 * Generate sample chart data
 */
function generateSampleChartData() {
  const days = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short' });
    
    days.push({
      name: dateStr,
      completed: Math.floor(Math.random() * 20) + 5,
      pending: Math.floor(Math.random() * 15) + 3,
      inProgress: Math.floor(Math.random() * 10) + 2,
      delayed: Math.floor(Math.random() * 5) + 1
    });
  }
  
  return days;
}

/**
 * Get activity type based on task status
 */
function getActivityType(task) {
  switch (task.status) {
    case 'completed':
      return 'task_completed';
    case 'pending':
      return 'task_created';
    case 'in-progress':
      return 'task_updated';
    case 'delayed':
      return 'task_delayed';
    default:
      return 'task_updated';
  }
}

/**
 * Generate activity description
 */
function getActivityDescription(task) {
  const statusMap = {
    'completed': 'completed',
    'pending': 'created',
    'in-progress': 'updated',
    'delayed': 'delayed'
  };
  
  const action = statusMap[task.status] || 'updated';
  return `${task.assignedBy?.name || 'Someone'} ${action} task "${task.title}"`;
}