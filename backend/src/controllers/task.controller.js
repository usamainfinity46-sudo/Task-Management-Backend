import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { Task } from '../models/task.model.js';
import { Subtask } from '../models/subtask.model.js';
import { createTaskSchema, updateTaskSchema, updateSubtaskSchema } from '../validations/task.schema.js';

const deriveTaskStatus = (subtasks) => {
  const allCompleted = subtasks.every((s) => s.status === 'completed');
  const anyInProgress = subtasks.some((s) => s.status === 'in_progress');
  if (allCompleted) return 'completed';
  if (anyInProgress) return 'in_progress';
  return 'pending';
};

export const createTask = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const body = createTaskSchema.parse(req.body);
    const start = dayjs(body.startDate).startOf('day');
    const end = dayjs(body.endDate).startOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      throw new Error('Invalid date range');
    }
    const companyId = req.user.role === 'admin' ? body.companyId || req.user.companyId : req.user.companyId;
    const task = await Task.create(
      [
        {
          companyId,
          title: body.title,
          description: body.description,
          managerId: req.user.id,
          assignees: body.assignees,
          startDate: start.toDate(),
          endDate: end.toDate(),
          priority: body.priority || 'medium',
          tags: body.tags || []
        }
      ],
      { session }
    );
    const days = end.diff(start, 'day') + 1;
    const subtasks = [];
    for (let i = 0; i < days; i++) {
      const date = start.add(i, 'day').toDate();
      body.assignees.forEach((assigneeId) => {
        subtasks.push({
          taskId: task[0]._id,
          companyId,
          date,
          assigneeId,
          status: 'pending',
          progressPct: 0
        });
      });
    }
    await Subtask.insertMany(subtasks, { session });
    await session.commitTransaction();
    res.status(201).json({ task: task[0] });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

export const listTasks = async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { companyId: req.user.companyId };
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const body = updateTaskSchema.parse(req.body);
    const filter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, companyId: req.user.companyId };
    const task = await Task.findOneAndUpdate(filter, body, { new: true });
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

export const deleteTask = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const filter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, companyId: req.user.companyId };
    await Subtask.deleteMany({ taskId: req.params.id }, { session });
    await Task.deleteOne(filter, { session });
    await session.commitTransaction();
    res.json({ success: true });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

export const listSubtasksByTask = async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? { taskId: req.params.id } : { taskId: req.params.id, companyId: req.user.companyId };
    const subtasks = await Subtask.find(filter).sort({ date: 1 });
    res.json({ subtasks });
  } catch (err) {
    next(err);
  }
};

export const updateSubtask = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const body = updateSubtaskSchema.parse(req.body);
    const filter =
      req.user.role === 'admin'
        ? { _id: req.params.subtaskId }
        : { _id: req.params.subtaskId, assigneeId: req.user.id };
    const subtask = await Subtask.findOneAndUpdate(filter, body, { new: true, session });
    if (!subtask) return res.status(404).json({ message: 'Not found' });

    const siblings = await Subtask.find({ taskId: subtask.taskId }).session(session);
    const status = deriveTaskStatus(siblings);
    await Task.findByIdAndUpdate(subtask.taskId, { status }, { session });

    await session.commitTransaction();
    res.json({ subtask });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
