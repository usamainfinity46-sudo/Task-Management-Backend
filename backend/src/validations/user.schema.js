import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['manager', 'staff']),
  companyId: z.string().optional(),
  managerId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional()
});

export const updateUserSchema = createUserSchema.partial().extend({
  password: z.string().min(6).optional()
});
