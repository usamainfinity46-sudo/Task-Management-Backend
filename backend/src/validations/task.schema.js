import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  assignees: z.array(z.string()).nonempty(),
  startDate: z.string(),
  endDate: z.string(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional()
});

export const updateTaskSchema = createTaskSchema.partial();

export const updateSubtaskSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed']),
  notes: z.string().optional(),
  progressPct: z.number().min(0).max(100).optional()
});
