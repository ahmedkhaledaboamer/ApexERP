import { z } from 'zod'

/** Select values arrive as '' for "none"; map that to null. */
const optionalId = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))

/** New / edit department. Mirrors the server's checks (it validates again). */
export const departmentSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required.').max(80, 'Keep the name under 80 characters.'),
  parentId: optionalId,
  headId: optionalId,
  costCenter: z.string().trim().max(40, 'Keep the cost center under 40 characters.'),
})

export type DepartmentFormInput = z.input<typeof departmentSchema>
export type DepartmentValues = z.output<typeof departmentSchema>

/** One department goal (add / edit inline). */
export const goalSchema = z.object({
  title: z.string().trim().min(1, 'Goal title is required.').max(160, 'Keep the goal under 160 characters.'),
  ownerId: optionalId,
  dueDate: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Pick a valid date.'),
})

export type GoalFormInput = z.input<typeof goalSchema>
export type GoalValues = z.output<typeof goalSchema>

/** Bulk move: who, where to, and optionally a new direct manager. */
export const moveMembersSchema = z.object({
  userIds: z.array(z.string()).min(1, 'Pick at least one person.'),
  toDepartmentId: z.string().min(1, 'Pick the department to move them to.'),
  /** '' = keep their current managers; '__none' = clear the manager. */
  managerId: z.string(),
})

export type MoveMembersValues = z.infer<typeof moveMembersSchema>

/** Maps the manager select's value to the API's `managerId` (undefined = unchanged). */
export function managerValue(v: string): string | null | undefined {
  if (!v) return undefined
  if (v === '__none') return null
  return v
}
