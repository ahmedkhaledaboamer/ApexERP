import { useNavigate } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { invoiceFromSourcePath } from '@/app/paths'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { Button, type ButtonProps } from '@/shared/components/ui/Button'

/** True when the caller can create invoices: accounting FULL and the plan includes Accounts & finance. */
export function useCanInvoice(): boolean {
  const user = useCurrentUser()
  const ent = useEntitlements()
  return !!user && scopeOf(user.role, 'accounting') === 'full' && ent.hasModule('accounting')
}

/**
 * "Create invoice" on the quotation, contract and won-customer screens: opens Invoices with the source dialog
 * prefilled (quotation, contract, or the won deal's lead). Renders nothing for roles that can't invoice.
 */
export function CreateInvoiceButton({ kind, id, label = 'Create invoice', ...rest }: { kind: 'quotation' | 'contract' | 'won'; id: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const navigate = useNavigate()
  if (!useCanInvoice()) return null
  return (
    <Button write variant="secondary" {...rest} onClick={() => navigate(invoiceFromSourcePath(kind, id))}>
      <Receipt className="size-4" aria-hidden />
      {label}
    </Button>
  )
}
