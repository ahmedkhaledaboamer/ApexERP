import { useCallback } from 'react'
import { useAppDispatch } from '@/store/hooks'
import { wonDialogOpened } from '@/store/wonSlice'

/**
 * Opens the one Won confirm dialog (mounted in the app layout). Every Won trigger goes through
 * here: accepting a quotation, dropping a lead on a won column, or picking a won status.
 */
export function useOpenWonDialog() {
  const dispatch = useAppDispatch()
  return useCallback(
    (leadId: string, quotationId: string | null = null) => dispatch(wonDialogOpened({ leadId, quotationId })),
    [dispatch],
  )
}
