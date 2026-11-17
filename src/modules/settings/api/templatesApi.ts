import { http } from '@/shared/lib/axios'
import type { MessageTemplate, TemplateFilter, TemplateInput, TemplateUpdateInput } from '@/modules/settings/templates/types'

/**
 * Message templates. Any signed-in user reads active templates; Settings viewers also get
 * inactive ones. Writes are System Admin only and audited. Validation errors are 422 with a
 * readable message (including the list of unknown variables).
 */

const enc = encodeURIComponent

export async function getTemplates(filter: TemplateFilter = {}): Promise<MessageTemplate[]> {
  return (await http.get<MessageTemplate[]>('/templates', { params: filter })).data
}

export async function getTemplate(id: string): Promise<MessageTemplate> {
  return (await http.get<MessageTemplate>(`/templates/${enc(id)}`)).data
}

export async function createTemplate(input: TemplateInput): Promise<MessageTemplate> {
  return (await http.post<MessageTemplate>('/templates', input)).data
}

export async function updateTemplate(id: string, input: TemplateUpdateInput): Promise<MessageTemplate> {
  return (await http.patch<MessageTemplate>(`/templates/${enc(id)}`, input)).data
}

export async function duplicateTemplate(id: string): Promise<MessageTemplate> {
  return (await http.post<MessageTemplate>(`/templates/${enc(id)}/duplicate`)).data
}

/** Makes it the default for its channel + purpose (the previous default is unset). */
export async function makeDefaultTemplate(id: string): Promise<MessageTemplate> {
  return (await http.post<MessageTemplate>(`/templates/${enc(id)}/default`)).data
}

export async function setTemplateActive(id: string, active: boolean): Promise<MessageTemplate> {
  return (await http.post<MessageTemplate>(`/templates/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data
}
