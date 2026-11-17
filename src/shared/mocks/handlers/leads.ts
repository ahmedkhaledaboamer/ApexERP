import { http } from 'msw'
import type { ActivityType } from '@/shared/types'
import type { LeadCreateInput, LeadUpdateInput, MoveLeadInput, QuickAddInput } from '@/modules/leads/types'
import * as svc from '@/shared/mocks/services/leads'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

export const leadHandlers = [
  // Before /leads/:id so "duplicates" isn't read as an id.
  http.get(`${API}/leads/duplicates`, ({ request }) => {
    const url = new URL(request.url)
    return respond(() => {
      userFrom(request)
      return svc.checkDuplicates({
        company: url.searchParams.get('company') ?? '',
        email: url.searchParams.get('email') ?? '',
        emails: (url.searchParams.get('emails') ?? '').split(',').filter(Boolean),
        website: url.searchParams.get('website') ?? '',
        excludeId: url.searchParams.get('excludeId') ?? undefined,
      })
    })
  }),
  // Also before /leads/:id.
  http.get(`${API}/leads/owners`, ({ request }) => respond(() => svc.getLeadOwners(userFrom(request)))),
  http.get(`${API}/leads`, ({ request }) => respond(() => svc.getLeads(userFrom(request)))),
  http.post(`${API}/leads`, async ({ request }) => {
    const body = (await request.json()) as QuickAddInput | LeadCreateInput
    return respond(() => svc.createLead(userFrom(request), body))
  }),
  http.get<Params>(`${API}/leads/:id`, ({ request, params }) => respond(() => svc.getLead(userFrom(request), params.id))),
  http.patch<Params>(`${API}/leads/:id`, async ({ request, params }) => {
    const body = (await request.json()) as LeadUpdateInput
    return respond(() => svc.updateLead(userFrom(request), params.id, body))
  }),
  http.patch<Params>(`${API}/leads/:id/stage`, async ({ request, params }) => {
    const body = (await request.json()) as Omit<MoveLeadInput, 'id'>
    return respond(() => svc.moveLeadStage(userFrom(request), { ...body, id: params.id }))
  }),
  http.patch<Params>(`${API}/leads/:id/do-not-contact`, async ({ request, params }) => {
    const { value } = (await request.json()) as { value: boolean }
    return respond(() => svc.setDoNotContact(userFrom(request), params.id, value))
  }),
  http.get<Params>(`${API}/leads/:id/activities`, ({ request, params }) =>
    respond(() => svc.getLeadActivities(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/leads/:id/activities`, async ({ request, params }) => {
    const body = (await request.json()) as { type: ActivityType; summary: string }
    return respond(() => svc.logActivity(userFrom(request), { ...body, leadId: params.id }))
  }),
  http.get<Params>(`${API}/leads/:id/notes`, ({ request, params }) =>
    respond(() => svc.getLeadNotes(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/leads/:id/notes`, async ({ request, params }) => {
    const { body } = (await request.json()) as { body: string }
    return respond(() => svc.addLeadNote(userFrom(request), { leadId: params.id, body }))
  }),
  http.get<Params>(`${API}/leads/:id/tasks`, ({ request, params }) =>
    respond(() => svc.getLeadTasks(userFrom(request), params.id)),
  ),
]
