import { http } from 'msw'
import type { ActivityType } from '@/shared/types'
import type { LeadCreateInput, LeadUpdateInput, MoveLeadInput, QuickAddInput } from '@/modules/leads/types'
import * as svc from '@/shared/mocks/services/leads'
import {
  activityMapper,
  DUPLICATE_QUERY,
  duplicateMapper,
  leadInputMapper,
  leadMapper,
  leadRowMapper,
  leadTaskMapper,
  leadUpdateMapper,
  noteMapper,
  ownerOptionMapper,
} from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

/** Leads speak the database's column names on the wire (shared/api/mappers.ts); services see the UI shape. */
export const leadHandlers = [
  // Before /leads/:id so "duplicates" isn't read as an id.
  http.get(`${API}/leads/duplicates`, ({ request }) => {
    const q = new URL(request.url).searchParams
    const get = (k: keyof typeof DUPLICATE_QUERY) => q.get(DUPLICATE_QUERY[k])
    return respondAs(duplicateMapper, () =>
      svc.checkDuplicates(userFrom(request), {
        company: get('company') ?? '',
        email: get('email') ?? '',
        emails: (get('emails') ?? '').split(',').filter(Boolean),
        website: get('website') ?? '',
        excludeId: get('excludeId') ?? undefined,
      }),
    )
  }),
  // Also before /leads/:id.
  http.get(`${API}/leads/owners`, ({ request }) => respondAs(ownerOptionMapper, () => svc.getLeadOwners(userFrom(request)))),
  http.get(`${API}/leads`, ({ request }) => respondAs(leadRowMapper, () => svc.getLeads(userFrom(request)))),
  http.post(`${API}/leads`, async ({ request }) => {
    const body = await bodyAs<QuickAddInput | LeadCreateInput>(request, leadInputMapper)
    return respondAs(leadRowMapper, () => svc.createLead(userFrom(request), body))
  }),
  http.get<Params>(`${API}/leads/:id`, ({ request, params }) => respondAs(leadMapper, () => svc.getLead(userFrom(request), params.id))),
  http.patch<Params>(`${API}/leads/:id`, async ({ request, params }) => {
    const body = await bodyAs<LeadUpdateInput>(request, leadUpdateMapper)
    return respondAs(leadRowMapper, () => svc.updateLead(userFrom(request), params.id, body))
  }),
  http.patch<Params>(`${API}/leads/:id/stage`, async ({ request, params }) => {
    const body = await bodyAs<Omit<MoveLeadInput, 'id'>>(request, leadUpdateMapper)
    return respondAs(leadRowMapper, () => svc.moveLeadStage(userFrom(request), { ...body, id: params.id }))
  }),
  http.patch<Params>(`${API}/leads/:id/do-not-contact`, async ({ request, params }) => {
    const { value } = (await request.json()) as { value: boolean }
    return respondAs(leadRowMapper, () => svc.setDoNotContact(userFrom(request), params.id, value))
  }),
  http.get<Params>(`${API}/leads/:id/activities`, ({ request, params }) =>
    respondAs(activityMapper, () => svc.getLeadActivities(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/leads/:id/activities`, async ({ request, params }) => {
    const body = (await request.json()) as { type: ActivityType; summary: string }
    return respondAs(activityMapper, () => svc.logActivity(userFrom(request), { ...body, leadId: params.id }))
  }),
  http.get<Params>(`${API}/leads/:id/notes`, ({ request, params }) =>
    respondAs(noteMapper, () => svc.getLeadNotes(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/leads/:id/notes`, async ({ request, params }) => {
    const { body } = (await request.json()) as { body: string }
    return respondAs(noteMapper, () => svc.addLeadNote(userFrom(request), { leadId: params.id, body }))
  }),
  http.get<Params>(`${API}/leads/:id/tasks`, ({ request, params }) =>
    respondAs(leadTaskMapper, () => svc.getLeadTasks(userFrom(request), params.id)),
  ),
]
