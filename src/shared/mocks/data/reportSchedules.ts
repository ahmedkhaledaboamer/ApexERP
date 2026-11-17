import type { ReportSchedule } from '@/modules/reports/types'

/**
 * Scheduled report e-mails, kept in memory for the session. Seeded with one schedule per
 * manager so the list isn't empty on first open. `nextRunAt` is filled in by the service.
 */
export const reportSchedules: ReportSchedule[] = [
  {
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
]

let seq = reportSchedules.length

export function nextScheduleId(): string {
  seq += 1
  return `RS-${seq}`
}
