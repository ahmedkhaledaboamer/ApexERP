import type { TaskPriority } from '@/modules/tasks/types'

/**
 * The Won flow: one atomic server action (POST /leads/:id/won) that converts a lead into a
 * customer, optional contract, and one delivery project per purchased service.
 */

export interface WonInput {
  /** Accepted quotation to win from (its services/contract are used). Optional. */
  quotationId?: string | null
  /** Purchased services (catalog ids). Defaults: quotation services, else the lead's recommended + interest services. */
  serviceIds: string[]
  /** Defaults to the lead owner's manager (or the owner). */
  projectManagerId: string
  /** yyyy-MM-dd; defaults to the next working day. */
  startDate: string
  /** Client-generated key; the same key twice returns 409 (double-submit guard). */
  idempotencyKey: string
}

export interface WonPreviewTask {
  title: string
  /** Template role; null when the template task has none (unassigned role → the project manager). */
  role: string | null
  ownerId: string
  ownerName: string
  /** True when the role couldn't be resolved to a person and fell back to the project manager. */
  fallbackOwner: boolean
  dueDate: string
  hours: number
  priority: TaskPriority
}

export interface WonPreviewProject {
  serviceId: string
  serviceName: string
  /** False when the service has no project template: the project is created with no tasks. */
  hasTemplate: boolean
  startDate: string
  endDate: string
  estimatedHours: number
  tasks: WonPreviewTask[]
}

export interface WonPreviewContract {
  title: string
  billing: 'Monthly' | 'Annual' | 'One-off'
  value: number
  startDate: string
  renewalDate: string
}

/** What will happen, shown in the confirm dialog before anything is saved. */
export interface WonPreview {
  leadId: string
  company: string
  status: string
  alreadyWon: boolean
  /** Blocking problems (e.g. no contact, no service). Empty = ready. */
  problems: string[]
  warnings: string[]
  customer: { mode: 'create' | 'link'; id: string | null; name: string }
  contacts: number
  notes: number
  activities: number
  quotation: { id: string; number: string; status: string; total: number } | null
  /** Accepted quotations the user may pick from. */
  quotationOptions: { id: string; number: string; title: string; total: number; status: string }[]
  /** Suggested purchased services (ids). */
  serviceIds: string[]
  /** Defaults the dialog starts from. */
  defaults: { projectManagerId: string; startDate: string }
  contract: WonPreviewContract | null
  projects: WonPreviewProject[]
  /** People who'll be notified. */
  notify: { id: string; name: string; why: string }[]
}

export interface WonResult {
  leadId: string
  customerId: string
  customerCreated: boolean
  contractId: string | null
  projectIds: string[]
  taskIds: string[]
  /** Where the UI should go next (first project). */
  redirectTo: string
}

/** Which step failed (returned in the 4xx/5xx body as `step`). */
export type WonStep = 'validate' | 'lead' | 'customer' | 'contract' | 'projects' | 'notify' | 'audit'
