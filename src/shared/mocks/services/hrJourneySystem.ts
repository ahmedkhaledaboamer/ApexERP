import type { Employee } from '@/modules/hr/types'
import type { OffboardingStep } from '@/modules/hr/peopleTypes'
import { users } from '@/shared/mocks/db'
import { settlementOf } from '@/shared/mocks/data/hrPayroll'
import type { Tenant } from '@/shared/mocks/tenant'
import { assetsHeldBy } from './hrAssets'

/**
 * The offboarding's SYSTEM steps, read live from their real source (moved here from services/hrEmployees.ts so the
 * employee profile's offboarding card and the offboarding journey's system items share one definition):
 *   assets      every company asset returned or marked lost (Company Assets)          — BLOCKING
 *   login       the linked system user deactivated, or no login (Settings › Users)
 *   settlement  the final settlement paid (Salary Management › Final settlements)
 */
export function offboardingSystemSteps(e: Tenant<Employee>): OffboardingStep[] {
  const held = assetsHeldBy(e)
  const login = e.userId ? users.find((u) => u.id === e.userId && u.companyId === e.companyId) : undefined
  const f = settlementOf(e.companyId, e.id)
  const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${f?.currency ?? ''}`.trim()
  return [
    {
      key: 'assets',
      label: 'Return company assets',
      done: held.length === 0,
      detail: held.length ? `${held.length} still assigned: ${held.map((a) => a.tag).join(', ')}` : 'Nothing assigned',
      blocking: true,
    },
    {
      key: 'login',
      label: 'Deactivate the login',
      done: !login || !login.active,
      detail: !login ? 'No system user' : login.active ? `${login.email} is still active (Settings › Users)` : 'Deactivated',
      blocking: false,
    },
    {
      key: 'settlement',
      label: 'Final settlement',
      done: f?.status === 'paid',
      detail: !f
        ? 'Not prepared yet: Salary Management › Final settlements (gratuity, unpaid salary, leave encashment, loans).'
        : f.status === 'paid'
          ? `Paid ${money(f.total)} on ${(f.paidAt ?? '').slice(0, 10)} (${f.id})`
          : `Draft ${f.id}: ${money(f.total)} to review and mark paid in Salary Management.`,
      blocking: false,
    },
  ]
}
