import dayjs from 'dayjs';
import { Subtask } from '../models/subtask.model.js';
import { Report } from '../models/report.model.js';

export const generateMonthlyReport = async (req, res, next) => {
  try {
    const { staffId } = req.params;
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const start = dayjs().year(year).month(month - 1).startOf('month');
    const end = start.endOf('month');
    const filter =
      req.user.role === 'admin'
        ? { assigneeId: staffId, date: { $gte: start.toDate(), $lte: end.toDate() } }
        : { assigneeId: staffId, companyId: req.user.companyId, date: { $gte: start.toDate(), $lte: end.toDate() } };

    const subtasks = await Subtask.find(filter);
    const total = subtasks.length;
    const completed = subtasks.filter((s) => s.status === 'completed').length;
    const inProgress = subtasks.filter((s) => s.status === 'in_progress').length;

    const stats = { total, completed, inProgress, completionRate: total ? Math.round((completed / total) * 100) : 0 };
    const report = await Report.create({
      companyId: req.user.companyId,
      staffId,
      month,
      year,
      stats,
      generatedAt: new Date()
    });

    res.json({ report });
  } catch (err) {
    next(err);
  }
};

export const listReports = async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
    const reports = await Report.find(filter).sort({ createdAt: -1 });
    res.json({ reports });
  } catch (err) {
    next(err);
  }
};
