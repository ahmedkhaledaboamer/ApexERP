import type { ActivityType } from '@/shared/types'
import { http } from '@/shared/lib/axios'
import type {
  ActivityView,
  DuplicateMatch,
  DuplicateQuery,
  ImportCheckRow,
  ImportLeadRow,
  ImportRequest,
  ImportResult,
  LeadCreateInput,
  LeadDetail,
  LeadOwnerOption,
  LeadRow,
  LeadUpdateInput,
  MoveLeadInput,
  NoteView,
  QuickAddInput,
  TaskView,
} from '@/modules/leads/types'

/** Leads API. Scope (own / team / full) is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getLeads(): Promise<LeadRow[]> {
  return (await http.get<LeadRow[]>('/leads')).data
}

export async function getLead(id: string): Promise<LeadDetail> {
  return (await http.get<LeadDetail>(`/leads/${enc(id)}`)).data
}

/** Quick add or the full form; 409 when it duplicates an existing lead (managers may pass `force`). */
export async function createLead(input: QuickAddInput | LeadCreateInput): Promise<LeadRow> {
  return (await http.post<LeadRow>('/leads', input)).data
}

export async function moveLeadStage({ id, ...body }: MoveLeadInput): Promise<LeadRow> {
  return (await http.patch<LeadRow>(`/leads/${enc(id)}/stage`, body)).data
}

export async function setDoNotContact(id: string, value: boolean): Promise<LeadRow> {
  return (await http.patch<LeadRow>(`/leads/${enc(id)}/do-not-contact`, { value })).data
}

export async function getLeadActivities(id: string): Promise<ActivityView[]> {
  return (await http.get<ActivityView[]>(`/leads/${enc(id)}/activities`)).data
}

export async function logActivity(input: { leadId: string; type: ActivityType; summary: string }): Promise<ActivityView> {
  const { leadId, ...body } = input
  return (await http.post<ActivityView>(`/leads/${enc(leadId)}/activities`, body)).data
}

export async function getLeadNotes(id: string): Promise<NoteView[]> {
  return (await http.get<NoteView[]>(`/leads/${enc(id)}/notes`)).data
}

export async function addLeadNote(input: { leadId: string; body: string }): Promise<NoteView> {
  return (await http.post<NoteView>(`/leads/${enc(input.leadId)}/notes`, { body: input.body })).data
}

export async function getLeadTasks(id: string): Promise<TaskView[]> {
  return (await http.get<TaskView[]>(`/leads/${enc(id)}/tasks`)).data
}

/** Matches across every lead, not just the caller's scope: a duplicate is a duplicate. */
export async function checkDuplicates(input: { company: string; email: string }): Promise<DuplicateMatch[]> {
  return (await http.get<DuplicateMatch[]>('/leads/duplicates', { params: input })).data
}

export async function updateLead(id: string, input: LeadUpdateInput): Promise<LeadRow> {
  return (await http.patch<LeadRow>(`/leads/${enc(id)}`, input)).data
}

/** Name, website/email domain and email matches; free-mail domains are ignored by the server. */
export async function checkDuplicatesFull(q: DuplicateQuery): Promise<DuplicateMatch[]> {
  const params: Record<string, string> = { company: q.company, email: q.email ?? '' }
  if (q.emails?.length) params.emails = q.emails.join(',')
  if (q.website) params.website = q.website
  if (q.excludeId) params.excludeId = q.excludeId
  return (await http.get<DuplicateMatch[]>('/leads/duplicates', { params })).data
}

/** People the caller may assign leads to, with their open-lead load. */
export async function getLeadOwners(): Promise<LeadOwnerOption[]> {
  return (await http.get<LeadOwnerOption[]>('/leads/owners')).data
}

export async function checkLeadImport(rows: ImportLeadRow[]): Promise<ImportCheckRow[]> {
  return (await http.post<ImportCheckRow[]>('/leads/import/check', { rows }, { timeout: 120_000 })).data
}

export async function importLeads(req: ImportRequest): Promise<ImportResult> {
  return (await http.post<ImportResult>('/leads/import', req, { timeout: 120_000 })).data
}
