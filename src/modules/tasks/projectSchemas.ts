import { z } from 'zod'
import { PROJECT_STATUSES, TASK_PRIORITIES } from '@/modules/tasks/types'

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg)

/** New project (Projects › New project drawer). Mirrors the POST /projects rules. */
export const projectSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the project a name.').max(160, 'Keep the name under 160 characters.'),
    customerId: z.string().min(1, 'Pick a customer.'),
    serviceId: z.string().min(1, 'Pick a service.'),
    managerId: z.string().min(1, 'Pick a project manager.'),
    startDate: date('Pick a start date.'),
    endDate: date('Pick an end date.'),
    status: z.enum(PROJECT_STATUSES),
    estimatedHours: z.coerce.number({ invalid_type_error: 'Enter hours.' }).min(0, 'Hours can’t be negative.').max(100_000, 'That’s too many hours.'),
    generateTasks: z.boolean(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date can’t be before the start date.',
    path: ['endDate'],
  })

export type ProjectValues = z.infer<typeof projectSchema>

/** Project dates (detail page › Edit dates). */
export const projectDatesSchema = z
  .object({ startDate: date('Pick a start date.'), endDate: date('Pick an end date.') })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date can’t be before the start date.', path: ['endDate'] })

export type ProjectDatesValues = z.infer<typeof projectDatesSchema>

/** Quick-add task on a project. */
export const quickTaskSchema = z.object({
  title: z.string().trim().min(1, 'Name the task.').max(200, 'Keep it under 200 characters.'),
  ownerId: z.string().min(1, 'Pick an owner.'),
  dueDate: z.union([z.literal(''), date('Pick a valid date.')]),
  priority: z.enum(TASK_PRIORITIES),
})

export type QuickTaskValues = z.infer<typeof quickTaskSchema>
