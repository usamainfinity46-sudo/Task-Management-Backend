import mongoose from 'mongoose';

const subtaskSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    date: { type: Date, required: true },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
    notes: { type: String },
    progressPct: { type: Number, min: 0, max: 100, default: 0 }
  },
  { timestamps: true }
);

export const Subtask = mongoose.model('Subtask', subtaskSchema);
