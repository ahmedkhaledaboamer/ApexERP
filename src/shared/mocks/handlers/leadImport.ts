import { http, type HttpHandler } from 'msw'
import type { ImportLeadRow, ImportRequest } from '@/modules/leads/types'
import * as svc from '@/shared/mocks/services/leadImport'
import { importCheckMapper, importRequestMapper, importResultMapper, importRowMapper } from '@/shared/api/mappers'
import { API, respondAs, userFrom } from './utils'

/** Registered before the leads handlers so `/leads/import/...` isn't read as `/leads/:id`. Snake_case on the wire. */
export const leadImportHandlers: HttpHandler[] = [
  http.post(`${API}/leads/import/check`, async ({ request }) => {
    const body = (await request.json()) as { rows?: unknown }
    // A malformed body keeps its shape so the service answers it as before (422).
    const rows = (Array.isArray(body?.rows) ? importRowMapper.fromApiList(body.rows) : body?.rows) as ImportLeadRow[]
    return respondAs(importCheckMapper, () => svc.checkImport(userFrom(request), rows))
  }),
  http.post(`${API}/leads/import`, async ({ request }) => {
    const body = importRequestMapper.fromApi(await request.json()) as ImportRequest
    return respondAs(importResultMapper, () => svc.runImport(userFrom(request), body))
  }),
]
