import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGateContext } from '@/modules/billing/hooks'
import { useReadOnly } from '@/shared/lib/readOnly'
import { useAppDispatch } from '@/store/hooks'
import { quickAddLeadSet } from '@/store/uiSlice'
import { availableCreateActions, type CreateAction } from './createActions'

/** The create actions the signed-in user may take now (role, plan, writable workspace). */
export function useCreateActions(): CreateAction[] {
  const gate = useGateContext()
  const readOnly = useReadOnly()
  return useMemo(() => availableCreateActions({ role: gate.role, entitlements: gate.entitlements, readOnly }), [gate.role, gate.entitlements, readOnly])
}

/** Opens an action's form: the global dialog, or the page URL that opens it. */
export function useRunCreateAction(): (a: CreateAction) => void {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  return useCallback(
    (a: CreateAction) => {
      if (a.target.kind === 'lead-quick-add') dispatch(quickAddLeadSet(true))
      else navigate(a.target.to)
    },
    [navigate, dispatch],
  )
}
