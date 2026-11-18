import { http } from '@/shared/lib/axios'
import type { MessageTemplate, TemplateFilter, TemplateInput, TemplateUpdateInput } from '@/modules/settings/templates/types'
import { TEMPLATE_QUERY, templateMapper } from '@/shared/api/mappers'

/**
 * Message templates. Any signed-in user reads active templates; Settings viewers also get
 * inactive ones. Writes are Company Admin only and audited. Validation errors are 422 with a
 * readable message (including the list of unknown variables).
 */

const enc = encodeURIComponent

export async function getTemplates(filter: TemplateFilter = {}): Promise<MessageTemplate[]> {
  const params = Object.fromEntries(Object.entries(filter).map(([k, v]) => [TEMPLATE_QUERY[k as keyof TemplateFilter] ?? k, v]))
  return templateMapper.fromApiList((await http.get<unknown>('/templates', { params })).data)
}

export async function getTemplate(id: string): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.get<unknown>(`/templates/${enc(id)}`)).data)
}

export async function createTemplate(input: TemplateInput): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.post<unknown>('/templates', templateMapper.toApi(input as never))).data)
}

export async function updateTemplate(id: string, input: TemplateUpdateInput): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.patch<unknown>(`/templates/${enc(id)}`, templateMapper.toApi(input as never))).data)
}

export async function duplicateTemplate(id: string): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.post<unknown>(`/templates/${enc(id)}/duplicate`)).data)
}

/** Makes it the default for its channel + purpose (the previous default is unset). */
export async function makeDefaultTemplate(id: string): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.post<unknown>(`/templates/${enc(id)}/default`)).data)
}

export async function setTemplateActive(id: string, active: boolean): Promise<MessageTemplate> {
  return templateMapper.fromApi((await http.post<unknown>(`/templates/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data)
}
