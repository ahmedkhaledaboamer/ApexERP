import { http, type HttpHandler } from 'msw'
import type { AssetInput, AssignInput, ContractInput, DocumentInput, EmployeeInput, RenewInput, ReturnInput } from '@/modules/hr/peopleTypes'
import * as emp from '@/shared/mocks/services/hrEmployees'
import * as ctr from '@/shared/mocks/services/hrContracts'
import * as ast from '@/shared/mocks/services/hrAssets'
import {
  hrAssetDetailMapper,
  hrAssetInputMapper,
  hrAssetRowMapper,
  hrAssignInputMapper,
  hrContractInputMapper,
  hrContractMapper,
  hrDocumentInputMapper,
  hrDocumentMapper,
  hrEmployeeDetailMapper,
  hrEmployeeExportMapper,
  hrEmployeeInputMapper,
  hrEmployeeRowMapper,
  hrPlainMapper,
  hrRenewInputMapper,
  hrReturnInputMapper,
  hrUnlinkedUserMapper,
} from '@/shared/api/hrMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

const query = (request: Request) => new URL(request.url).searchParams

/**
 * HR › Employees, Employee contracts, Company assets (docs/API.md › HR). Paths under /hr are gated by the
 * plan module `hr` (request policy); the scope comes from the `hr` column (services/hrAccess.ts).
 * Static paths (`/hr/employees/export`) are registered before `/hr/employees/:id`.
 */
export const hrPeopleHandlers: HttpHandler[] = [
  /* ---- employees ---- */
  http.get(`${API}/hr/employees`, ({ request }) => respondAs(hrEmployeeRowMapper, () => emp.listEmployees(userFrom(request)))),
  http.get(`${API}/hr/employees/export`, ({ request }) => respondAs(hrEmployeeExportMapper, () => emp.exportEmployees(userFrom(request)))),
  http.post(`${API}/hr/employees`, async ({ request }) => {
    const input = await body<Partial<EmployeeInput>>(request, hrEmployeeInputMapper)
    return respondAs(hrEmployeeDetailMapper, () => emp.createEmployeeFor(userFrom(request), input))
  }),
  http.get(`${API}/hr/users/unlinked`, ({ request }) => respondAs(hrUnlinkedUserMapper, () => emp.unlinkedUsers(userFrom(request)))),
  http.get<Id>(`${API}/hr/employees/:id`, ({ request, params }) => respondAs(hrEmployeeDetailMapper, () => emp.getEmployee(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/employees/:id`, async ({ request, params }) => {
    const input = await body<Partial<EmployeeInput>>(request, hrEmployeeInputMapper)
    return respondAs(hrEmployeeDetailMapper, () => emp.updateEmployee(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/employees/:id/reveal`, async ({ request, params }) => {
    const input = await body<{ field?: unknown }>(request, hrPlainMapper)
    return respondAs(hrPlainMapper, () => emp.revealEmployeeField(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/employees/:id/link-user`, async ({ request, params }) => {
    const input = await body<{ userId?: unknown }>(request, hrPlainMapper)
    return respondAs(hrEmployeeDetailMapper, () => emp.linkUser(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/employees/:id/offboarding/complete`, ({ request, params }) =>
    respondAs(hrEmployeeDetailMapper, () => emp.completeOffboarding(userFrom(request), params.id)),
  ),

  /* ---- documents ---- */
  http.post<Id>(`${API}/hr/employees/:id/documents`, async ({ request, params }) => {
    const input = await body<Partial<DocumentInput>>(request, hrDocumentInputMapper)
    return respondAs(hrDocumentMapper, () => emp.addDocument(userFrom(request), params.id, input))
  }),
  http.patch<Id>(`${API}/hr/documents/:id`, async ({ request, params }) => {
    const input = await body<Partial<DocumentInput>>(request, hrDocumentInputMapper)
    return respondAs(hrDocumentMapper, () => emp.updateDocument(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/hr/documents/:id`, ({ request, params }) => respondAs(hrPlainMapper, () => emp.deleteDocument(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/documents/:id/reveal`, ({ request, params }) => respondAs(hrPlainMapper, () => emp.revealDocument(userFrom(request), params.id))),

  /* ---- contracts ---- */
  http.get(`${API}/hr/contracts`, ({ request }) => {
    const q = query(request)
    return respondAs(hrContractMapper, () =>
      ctr.listContracts(userFrom(request), { type: q.get('type'), status: q.get('status'), endingWithin: q.get('ending_within'), employeeId: q.get('employee_id') }),
    )
  }),
  http.post(`${API}/hr/contracts`, async ({ request }) => {
    const input = await body<Partial<ContractInput>>(request, hrContractInputMapper)
    return respondAs(hrContractMapper, () => ctr.createContract(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/contracts/:id`, ({ request, params }) => respondAs(hrContractMapper, () => ctr.getContract(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/contracts/:id`, async ({ request, params }) => {
    const input = await body<Partial<ContractInput>>(request, hrContractInputMapper)
    return respondAs(hrContractMapper, () => ctr.updateContract(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/contracts/:id/renew`, async ({ request, params }) => {
    const input = await body<RenewInput>(request, hrRenewInputMapper)
    return respondAs(hrContractMapper, () => ctr.renewContract(userFrom(request), params.id, input))
  }),

  /* ---- assets ---- */
  http.get(`${API}/hr/assets`, ({ request }) => {
    const q = query(request)
    return respondAs(hrAssetRowMapper, () => ast.listAssets(userFrom(request), { status: q.get('status'), category: q.get('category'), employeeId: q.get('employee_id') }))
  }),
  http.post(`${API}/hr/assets`, async ({ request }) => {
    const input = await body<Partial<AssetInput>>(request, hrAssetInputMapper)
    return respondAs(hrAssetRowMapper, () => ast.createAsset(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/assets/:id`, ({ request, params }) => respondAs(hrAssetDetailMapper, () => ast.getAsset(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/assets/:id`, async ({ request, params }) => {
    const input = await body<Partial<AssetInput>>(request, hrAssetInputMapper)
    return respondAs(hrAssetDetailMapper, () => ast.updateAsset(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/assets/:id/assign`, async ({ request, params }) => {
    const input = await body<Partial<AssignInput>>(request, hrAssignInputMapper)
    return respondAs(hrAssetDetailMapper, () => ast.assignAsset(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/assets/:id/return`, async ({ request, params }) => {
    const input = await body<Partial<ReturnInput>>(request, hrReturnInputMapper)
    return respondAs(hrAssetDetailMapper, () => ast.returnAsset(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/hr/assets/:id/lost`, async ({ request, params }) => {
    const input = await body<{ note?: string }>(request, hrPlainMapper)
    return respondAs(hrAssetDetailMapper, () => ast.markAssetLost(userFrom(request), params.id, input))
  }),
]
