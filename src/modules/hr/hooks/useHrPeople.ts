import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/hr/api/hrPeopleApi'
import type { AssetInput, AssignInput, ContractInput, DocumentInput, EmployeeInput, RenewInput, ReturnInput } from '@/modules/hr/peopleTypes'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/**
 * HR › Employees, Employee contracts, Company assets. Keys live under ['hr', uid, 'people', …]; every write
 * refreshes the whole ['hr'] tree (a contract or an asset shows on the employee profile too) and the bell.
 */
export const hrPeopleKeys = {
  employees: (uid: string) => ['hr', uid, 'people', 'employees'] as const,
  employee: (uid: string, id: string) => ['hr', uid, 'people', 'employee', id] as const,
  unlinked: (uid: string) => ['hr', uid, 'people', 'unlinked'] as const,
  contracts: (uid: string, f: api.ContractFilters) => ['hr', uid, 'people', 'contracts', f] as const,
  assets: (uid: string) => ['hr', uid, 'people', 'assets'] as const,
  asset: (uid: string, id: string) => ['hr', uid, 'people', 'asset', id] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** The caller's HR scope (matrix `hr`): `full` manages; team / own read; hidden never reaches these pages. */
export function useHrScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'hr') : 'hidden'
  return { scope, canManage: scope === 'full' }
}

function useOn(enabled: boolean) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hr'] })
    void qc.invalidateQueries({ queryKey: ['alerts'] })
  }
}

/* ---- employees ---- */

export function useEmployeesQuery(enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.employees(uid), queryFn: api.getEmployees, enabled: useOn(enabled), retry: false })
}
export function useEmployeeQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.employee(uid, id), queryFn: () => api.getEmployee(id), enabled: useOn(!!id), retry: false })
}
export function useUnlinkedUsersQuery(enabled: boolean) {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.unlinked(uid), queryFn: api.getUnlinkedUsers, enabled: useOn(enabled), retry: false })
}
export function useSaveEmployee() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<EmployeeInput> }) => api.saveEmployee(input, id), onSuccess: invalidate })
}
export function useLinkUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) => api.linkUser(id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['settings-users'] })
    },
  })
}
export function useCompleteOffboarding() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.completeOffboarding(id), onSuccess: invalidate })
}

/* ---- documents ---- */

export function useSaveDocument() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ input, employeeId, id }: { input: Partial<DocumentInput>; employeeId?: string; id?: string }) => api.saveDocument(input, { employeeId, id }),
    onSuccess: invalidate,
  })
}
export function useDeleteDocument() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteDocument(id), onSuccess: invalidate })
}

/* ---- contracts ---- */

export function useContractsQuery(f: api.ContractFilters = {}) {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.contracts(uid, f), queryFn: () => api.getContracts(f), enabled: useOn(true), retry: false })
}
export function useSaveContract() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<ContractInput> }) => api.saveContract(input, id), onSuccess: invalidate })
}
export function useRenewContract() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: RenewInput }) => api.renewContract(id, input), onSuccess: invalidate })
}

/* ---- assets ---- */

export function useAssetsQuery() {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.assets(uid), queryFn: api.getAssets, enabled: useOn(true), retry: false })
}
export function useAssetQuery(id: string | null) {
  const uid = useUid()
  return useQuery({ queryKey: hrPeopleKeys.asset(uid, id ?? ''), queryFn: () => api.getAsset(id ?? ''), enabled: useOn(!!id), retry: false })
}
export function useSaveAsset() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<AssetInput> }) => api.saveAsset(input, id), onSuccess: invalidate })
}
export function useAssignAsset() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: AssignInput }) => api.assignAsset(id, input), onSuccess: invalidate })
}
export function useReturnAsset() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: ReturnInput }) => api.returnAsset(id, input), onSuccess: invalidate })
}
export function useMarkAssetLost() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, note }: { id: string; note: string }) => api.markAssetLost(id, note), onSuccess: invalidate })
}
