import { http } from '@/shared/lib/axios'
import type {
  AssetDetail,
  AssetInput,
  AssetRow,
  AssignInput,
  ContractInput,
  DocumentInput,
  EmployeeContract,
  EmployeeDetail,
  EmployeeDocument,
  EmployeeExportRow,
  EmployeeInput,
  EmployeeRow,
  RenewInput,
  ReturnInput,
  UnlinkedUser,
} from '@/modules/hr/peopleTypes'
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

/** HR › Employees, Employee contracts, Company assets (docs/API.md › HR). */

const enc = encodeURIComponent

/* ---- employees ---- */

export async function getEmployees(): Promise<EmployeeRow[]> {
  return hrEmployeeRowMapper.fromApiList((await http.get<unknown>('/hr/employees')).data)
}
export async function exportEmployees(): Promise<EmployeeExportRow[]> {
  return hrEmployeeExportMapper.fromApiList((await http.get<unknown>('/hr/employees/export')).data)
}
export async function getEmployee(id: string): Promise<EmployeeDetail> {
  return hrEmployeeDetailMapper.fromApi((await http.get<unknown>(`/hr/employees/${enc(id)}`)).data)
}
export async function saveEmployee(input: Partial<EmployeeInput>, id?: string): Promise<EmployeeDetail> {
  const body = hrEmployeeInputMapper.toApi(input as EmployeeInput)
  const res = id ? await http.patch<unknown>(`/hr/employees/${enc(id)}`, body) : await http.post<unknown>('/hr/employees', body)
  return hrEmployeeDetailMapper.fromApi(res.data)
}
export async function revealIban(id: string): Promise<string> {
  const res = hrPlainMapper.fromApi((await http.post<unknown>(`/hr/employees/${enc(id)}/reveal`, { field: 'iban' })).data)
  return String(res.value ?? '')
}
export async function getUnlinkedUsers(): Promise<UnlinkedUser[]> {
  return hrUnlinkedUserMapper.fromApiList((await http.get<unknown>('/hr/users/unlinked')).data)
}
export async function linkUser(id: string, userId: string | null): Promise<EmployeeDetail> {
  return hrEmployeeDetailMapper.fromApi((await http.post<unknown>(`/hr/employees/${enc(id)}/link-user`, { user_id: userId })).data)
}
export async function completeOffboarding(id: string): Promise<EmployeeDetail> {
  return hrEmployeeDetailMapper.fromApi((await http.post<unknown>(`/hr/employees/${enc(id)}/offboarding/complete`)).data)
}

/* ---- documents ---- */

export async function saveDocument(input: Partial<DocumentInput>, opts: { employeeId?: string; id?: string }): Promise<EmployeeDocument> {
  const body = hrDocumentInputMapper.toApi(input as DocumentInput)
  const res = opts.id ? await http.patch<unknown>(`/hr/documents/${enc(opts.id)}`, body) : await http.post<unknown>(`/hr/employees/${enc(opts.employeeId ?? '')}/documents`, body)
  return hrDocumentMapper.fromApi(res.data)
}
export async function deleteDocument(id: string): Promise<void> {
  await http.delete(`/hr/documents/${enc(id)}`)
}
export async function revealDocument(id: string): Promise<string> {
  const res = hrPlainMapper.fromApi((await http.post<unknown>(`/hr/documents/${enc(id)}/reveal`)).data)
  return String(res.number ?? '')
}

/* ---- contracts ---- */

export interface ContractFilters {
  type?: string
  status?: string
  endingWithin?: number
}
export async function getContracts(f: ContractFilters = {}): Promise<EmployeeContract[]> {
  const params: Record<string, string> = {}
  if (f.type) params.type = f.type
  if (f.status) params.status = f.status
  if (f.endingWithin) params.ending_within = String(f.endingWithin)
  return hrContractMapper.fromApiList((await http.get<unknown>('/hr/contracts', { params })).data)
}
export async function saveContract(input: Partial<ContractInput>, id?: string): Promise<EmployeeContract> {
  const body = hrContractInputMapper.toApi(input as ContractInput)
  const res = id ? await http.patch<unknown>(`/hr/contracts/${enc(id)}`, body) : await http.post<unknown>('/hr/contracts', body)
  return hrContractMapper.fromApi(res.data)
}
export async function renewContract(id: string, input: RenewInput): Promise<EmployeeContract> {
  return hrContractMapper.fromApi((await http.post<unknown>(`/hr/contracts/${enc(id)}/renew`, hrRenewInputMapper.toApi(input))).data)
}

/* ---- assets ---- */

export async function getAssets(): Promise<AssetRow[]> {
  return hrAssetRowMapper.fromApiList((await http.get<unknown>('/hr/assets')).data)
}
export async function getAsset(id: string): Promise<AssetDetail> {
  return hrAssetDetailMapper.fromApi((await http.get<unknown>(`/hr/assets/${enc(id)}`)).data)
}
export async function saveAsset(input: Partial<AssetInput>, id?: string): Promise<AssetRow> {
  const body = hrAssetInputMapper.toApi(input as AssetInput)
  const res = id ? await http.patch<unknown>(`/hr/assets/${enc(id)}`, body) : await http.post<unknown>('/hr/assets', body)
  return hrAssetRowMapper.fromApi(res.data)
}
export async function assignAsset(id: string, input: AssignInput): Promise<AssetDetail> {
  return hrAssetDetailMapper.fromApi((await http.post<unknown>(`/hr/assets/${enc(id)}/assign`, hrAssignInputMapper.toApi(input))).data)
}
export async function returnAsset(id: string, input: ReturnInput): Promise<AssetDetail> {
  return hrAssetDetailMapper.fromApi((await http.post<unknown>(`/hr/assets/${enc(id)}/return`, hrReturnInputMapper.toApi(input))).data)
}
export async function markAssetLost(id: string, note: string): Promise<AssetDetail> {
  return hrAssetDetailMapper.fromApi((await http.post<unknown>(`/hr/assets/${enc(id)}/lost`, { note })).data)
}
