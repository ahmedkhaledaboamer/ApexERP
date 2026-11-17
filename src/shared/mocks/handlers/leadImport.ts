import { http, type HttpHandler } from 'msw'
import type { ImportLeadRow, ImportRequest } from '@/modules/leads/types'
import * as svc from '@/shared/mocks/services/leadImport'
import { API, respond, userFrom } from './utils'

/** Registered before the leads handlers so `/leads/import/...` isn't read as `/leads/:id`. */
export const leadImportHandlers: HttpHandler[] = [
  http.post(`${API}/leads/import/check`, async ({ request }) => {
    const body = (await request.json()) as { rows: ImportLeadRow[] }
    return respond(() => svc.checkImport(userFrom(request), body.rows))
  }),
  http.post(`${API}/leads/import`, async ({ request }) => {
    const body = (await request.json()) as ImportRequest
    return respond(() => svc.runImport(userFrom(request), body))
  }),
]
