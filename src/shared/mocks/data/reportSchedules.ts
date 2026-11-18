import type { ReportSchedule } from '@/modules/reports/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * Scheduled report e-mails, kept in memory for the session, per company. Seeded with one
 * schedule per manager so the list isn't empty on first open. `nextRunAt` is filled in by the
 * service. Ids come from one global sequence so they never collide across tenants.
 */
export const reportSchedules: Tenant<ReportSchedule>[] = [
  {
    companyId: 'co_apex',
    id: 'RS-1',
    report: 'all',
    frequency: 'weekly',
    day: 1,
    time: '08:00',
    recipients: ['layla@apexaora.ae', 'karim@apexaora.ae'],
    format: 'excel',
    createdBy: 'u2',
    createdByName: 'Layla Mansour',
    createdAt: '2026-09-01T06:00:00.000Z',
    nextRunAt: '',
  },
  {
    companyId: 'co_apex',
    id: 'RS-2',
    report: 'agents',
    frequency: 'monthly',
    day: 1,
    time: '09:00',
    recipients: ['karim@apexaora.ae'],
    format: 'pdf',
    createdBy: 'u3',
    createdByName: 'Karim Nasser',
    createdAt: '2026-09-12T06:00:00.000Z',
    nextRunAt: '',
  },
  {
    companyId: 'co_crest',
    id: 'RS-3',
    report: 'all',
    frequency: 'weekly',
    // Sunday: the first working day of the Saudi week.
    day: 7,
    time: '07:30',
    recipients: ['noura@crestlogistics.sa', 'majed@crestlogistics.sa'],
    format: 'excel',
    createdBy: 'u102',
    createdByName: 'Noura Al Qahtani',
    createdAt: '2026-09-20T05:00:00.000Z',
    nextRunAt: '',
  },
]

let seq = reportSchedules.length
registerArray('reportSchedules', reportSchedules)
registerValue('reportSchedules.seq', () => seq, (v) => { seq = v })

export function nextScheduleId(): string {
  seq += 1
  return `RS-${seq}`
}
