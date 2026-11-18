import type { ActivityType } from '@/shared/types'
import { http } from '@/shared/lib/axios'
import {
  activityMapper,
  DUPLICATE_QUERY,
  duplicateMapper,
  importCheckMapper,
  importRequestMapper,
  importResultMapper,
  importRowMapper,
  leadInputMapper,
  leadMapper,
  leadRowMapper,
  leadTaskMapper,
  leadUpdateMapper,
  noteMapper,
  ownerOptionMapper,
} from '@/shared/api/mappers'
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

/**
 * Leads API. Scope (own / team / full) is decided by the server from the auth token. The API speaks
 * the leads table's column names (company_name, status_id, next_follow_up_date…); every function
 * maps both ways (shared/api/mappers.ts), so the screens only see the camelCase types.
 */

const enc = encodeURIComponent

export async function getLeads(): Promise<LeadRow[]> {
  return leadRowMapper.fromApiList((await http.get<unknown>('/leads')).data)
}

export async function getLead(id: string): Promise<LeadDetail> {
  return leadMapper.fromApi((await http.get<unknown>(`/leads/${enc(id)}`)).data)
}

/** Quick add or the full form; 409 when it duplicates an existing lead (managers may pass `force`). */
export async function createLead(input: QuickAddInput | LeadCreateInput): Promise<LeadRow> {
  return leadRowMapper.fromApi((await http.post<unknown>('/leads', leadInputMapper.toApi(input as never))).data)
}

export async function moveLeadStage({ id, ...body }: MoveLeadInput): Promise<LeadRow> {
  return leadRowMapper.fromApi((await http.patch<unknown>(`/leads/${enc(id)}/stage`, leadUpdateMapper.toApi(body))).data)
}

export async function setDoNotContact(id: string, value: boolean): Promise<LeadRow> {
  return leadRowMapper.fromApi((await http.patch<unknown>(`/leads/${enc(id)}/do-not-contact`, { value })).data)
}

export async function getLeadActivities(id: string): Promise<ActivityView[]> {
  return activityMapper.fromApiList((await http.get<unknown>(`/leads/${enc(id)}/activities`)).data)
}

export async function logActivity(input: { leadId: string; type: ActivityType; summary: string }): Promise<ActivityView> {
  const { leadId, ...body } = input
  return activityMapper.fromApi((await http.post<unknown>(`/leads/${enc(leadId)}/activities`, body)).data)
}

export async function getLeadNotes(id: string): Promise<NoteView[]> {
  return noteMapper.fromApiList((await http.get<unknown>(`/leads/${enc(id)}/notes`)).data)
}

export async function addLeadNote(input: { leadId: string; body: string }): Promise<NoteView> {
  return noteMapper.fromApi((await http.post<unknown>(`/leads/${enc(input.leadId)}/notes`, { body: input.body })).data)
}

export async function getLeadTasks(id: string): Promise<TaskView[]> {
  return leadTaskMapper.fromApiList((await http.get<unknown>(`/leads/${enc(id)}/tasks`)).data)
}

/** Matches across every lead, not just the caller's scope: a duplicate is a duplicate. */
export async function checkDuplicates(input: { company: string; email: string }): Promise<DuplicateMatch[]> {
  const params = { [DUPLICATE_QUERY.company]: input.company, [DUPLICATE_QUERY.email]: input.email }
  return duplicateMapper.fromApiList((await http.get<unknown>('/leads/duplicates', { params })).data)
}

export async function updateLead(id: string, input: LeadUpdateInput): Promise<LeadRow> {
  return leadRowMapper.fromApi((await http.patch<unknown>(`/leads/${enc(id)}`, leadUpdateMapper.toApi(input))).data)
}

/** Name, website/email domain and email matches; free-mail domains are ignored by the server. */
export async function checkDuplicatesFull(q: DuplicateQuery): Promise<DuplicateMatch[]> {
  const params: Record<string, string> = { [DUPLICATE_QUERY.company]: q.company, [DUPLICATE_QUERY.email]: q.email ?? '' }
  if (q.emails?.length) params[DUPLICATE_QUERY.emails] = q.emails.join(',')
  if (q.website) params[DUPLICATE_QUERY.website] = q.website
  if (q.excludeId) params[DUPLICATE_QUERY.excludeId] = q.excludeId
  return duplicateMapper.fromApiList((await http.get<unknown>('/leads/duplicates', { params })).data)
}

/** People the caller may assign leads to, with their open-lead load. */
export async function getLeadOwners(): Promise<LeadOwnerOption[]> {
  return ownerOptionMapper.fromApiList((await http.get<unknown>('/leads/owners')).data)
}

export async function checkLeadImport(rows: ImportLeadRow[]): Promise<ImportCheckRow[]> {
  const body = { rows: importRowMapper.toApi(rows) }
  return importCheckMapper.fromApiList((await http.post<unknown>('/leads/import/check', body, { timeout: 120_000 })).data)
}

export async function importLeads(req: ImportRequest): Promise<ImportResult> {
  return importResultMapper.fromApi((await http.post<unknown>('/leads/import', importRequestMapper.toApi(req), { timeout: 120_000 })).data)
}
