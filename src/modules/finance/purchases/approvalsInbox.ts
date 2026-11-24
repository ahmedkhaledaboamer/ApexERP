import { useBills, usePurchaseOrders } from '@/modules/finance/purchases/api'
import { useClaims } from '@/modules/finance/expenses/api'
import { useEntitlements } from '@/modules/billing/hooks'

/**
 * The approvals inbox (My HR card, user menu badge, /finance/approvals): everything waiting for the CALLER's decision,
 * from the existing approval lists — POs `?view=awaiting`, bills `?status=awaiting`, expense claims `?view=approvals`.
 * Department heads reach it without accounting access (the API scopes each list to the steps they can act on).
 */
export function useApprovalsInbox(enabled = true) {
  const on = useEntitlements().hasModule('accounting') && enabled
  const pos = usePurchaseOrders({ view: 'awaiting' })
  const bills = useBills({ status: 'awaiting' }, on)
  const claims = useClaims({ view: 'approvals' }, on)
  const count = on ? (pos.data?.length ?? 0) + (bills.data?.length ?? 0) + (claims.data?.length ?? 0) : 0
  return { on, pos, bills, claims, count, loading: on && (pos.isPending || bills.isPending || claims.isPending) }
}
