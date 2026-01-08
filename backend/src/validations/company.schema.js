import { z } from 'zod';

export const companySchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  status: z.enum(['active', 'inactive']).optional()
});
