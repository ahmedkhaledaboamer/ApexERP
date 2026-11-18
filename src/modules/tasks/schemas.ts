import { z } from 'zod'
import { TASK_LINK_TYPES, TASK_PRIORITIES, TASK_STATUSES, type TaskLinkType } from '@/modules/tasks/types'

/**
 * Task validation, shared by the task forms (drawer, quick add) and the mock API so the rules
 * agree on both sides.
 */

export const TASK_TITLE_MAX = 160
export const TASK_DESCRIPTION_MAX = 5000
export const TASK_COMMENT_MAX = 2000
/** Mocked upload limit per attachment. */
export const TASK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
export const TASK_HOURS_MAX = 1000
/** time_entries.hours is decimal(5,2): one entry is at most 24 h. */
export const TIME_ENTRY_HOURS_MAX = 24
/** time_entries.description is string(255). */
export const TIME_ENTRY_DESCRIPTION_MAX = 255

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31.')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00`).getTime()), 'That date doesn’t exist.')

export const taskLinkSchema = z.object({
  type: z.enum(TASK_LINK_TYPES as [TaskLinkType, ...TaskLinkType[]], {
    errorMap: () => ({ message: 'Link a lead, customer or event (the project is its own field).' }),
  }),
  id: z.string().trim().min(1, 'Pick a record to link.'),
})

const hours = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number.` })
    .min(0, `${label} can’t be negative.`)
    .max(TASK_HOURS_MAX, `${label} can’t exceed ${TASK_HOURS_MAX}.`)

const fields = {
  title: z.string().trim().min(1, 'Give the task a title.').max(TASK_TITLE_MAX, `Keep the title under ${TASK_TITLE_MAX} characters.`),
  description: z.string().max(TASK_DESCRIPTION_MAX, `Keep the description under ${TASK_DESCRIPTION_MAX} characters.`),
  ownerId: z.string().min(1, 'Pick an owner.'),
  followerIds: z.array(z.string().min(1)).max(50, 'Too many followers.'),
  priority: z.enum(TASK_PRIORITIES, { errorMap: () => ({ message: `Priority must be one of ${TASK_PRIORITIES.join(', ')}.` }) }),
  dueDate: isoDate.nullable(),
  status: z.enum(TASK_STATUSES, { errorMap: () => ({ message: `Status must be one of ${TASK_STATUSES.join(', ')}.` }) }),
  link: taskLinkSchema.nullable(),
  projectId: z.string().min(1).nullable(),
  parentTaskId: z.string().min(1).nullable(),
  estimatedHours: hours('Estimated hours'),
}

/** POST /tasks body. */
export const taskInputSchema = z.object({
  title: fields.title,
  description: fields.description.optional(),
  ownerId: fields.ownerId.optional(),
  followerIds: fields.followerIds.optional(),
  priority: fields.priority.optional(),
  dueDate: fields.dueDate.optional(),
  status: fields.status.optional(),
  link: fields.link.optional(),
  projectId: fields.projectId.optional(),
  parentTaskId: fields.parentTaskId.optional(),
  estimatedHours: fields.estimatedHours.optional(),
})

/** PATCH /tasks/:id body (every field optional; the parent can't be changed). */
export const taskUpdateSchema = taskInputSchema.omit({ parentTaskId: true }).partial().extend({ force: z.boolean().optional() })

export const BLOCKED_REASON_MIN = 3
export const BLOCKED_REASON_MAX = 280
/** Why a task is blocked (Block… dialog and POST /tasks/:id/block: missing or short is a 422). */
export const blockedReasonSchema = z
  .string({ required_error: 'Say why the task is blocked.', invalid_type_error: 'Say why the task is blocked.' })
  .trim()
  .min(BLOCKED_REASON_MIN, 'Say briefly what it’s waiting on.')
  .max(BLOCKED_REASON_MAX, `Keep it under ${BLOCKED_REASON_MAX} characters.`)

export const taskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first.').max(TASK_COMMENT_MAX, `Keep comments under ${TASK_COMMENT_MAX} characters.`),
  mentions: z.array(z.string()).optional(),
})

/** POST /tasks/:id/attachments body (attachments.original_name, size_bytes, mime_type). */
export const taskAttachmentSchema = z.object({
  name: z.string().trim().min(1, 'The file needs a name.').max(255, 'The file name is too long.'),
  sizeBytes: z.number({ required_error: 'sizeBytes is required.' }).int().min(0).max(TASK_ATTACHMENT_MAX_BYTES, 'Files can be up to 25 MB.'),
  mimeType: z.string().max(100).optional(),
})

/** POST /tasks/:id/time-entries body (time_entries.entry_date, hours, description, is_billable). */
export const timeEntrySchema = z.object({
  entryDate: isoDate,
  hours: z
    .number({ required_error: 'Enter the hours.', invalid_type_error: 'Hours must be a number.' })
    .positive('Hours must be more than 0.')
    .max(TIME_ENTRY_HOURS_MAX, `One entry can be at most ${TIME_ENTRY_HOURS_MAX} hours.`)
    .refine((h) => Math.round(h * 100) === h * 100, 'Use at most two decimals.'),
  description: z.string().trim().max(TIME_ENTRY_DESCRIPTION_MAX, `Keep it under ${TIME_ENTRY_DESCRIPTION_MAX} characters.`).nullable().optional(),
  isBillable: z.boolean().optional(),
})

/** Task drawer form (all fields present; hours as numbers). */
export const taskFormSchema = z
  .object({
    title: fields.title,
    description: fields.description,
    ownerId: fields.ownerId,
    followerIds: fields.followerIds,
    priority: fields.priority,
    status: fields.status,
    dueDate: z.union([isoDate, z.literal('')]),
    linkType: z.union([taskLinkSchema.shape.type, z.literal('')]),
    linkId: z.string(),
    projectId: z.string(),
    estimatedHours: fields.estimatedHours,
  })
  .superRefine((v, ctx) => {
    if (v.linkType && !v.linkId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['linkId'], message: 'Pick a record to link, or remove the link.' })
  })
export type TaskFormValues = z.infer<typeof taskFormSchema>

/** Quick add (title + due + owner + optional link). */
export const quickAddSchema = z.object({
  title: fields.title,
  dueDate: z.union([isoDate, z.literal('')]),
  ownerId: fields.ownerId,
})
export type QuickAddValues = z.infer<typeof quickAddSchema>

/** First zod issue as a sentence, for API errors. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the task details.'
}
