import { users } from '@/shared/mocks/db'
import { scopeOf } from '@/shared/lib/permissions'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrCertificates, hrCourses } from '@/shared/mocks/data/hrTalent'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { CERTIFICATE_ALERT_DAYS } from '@/modules/hr/trainingTypes'
import { assertModule } from '@/shared/mocks/services/billing'

/**
 * Certificate expiry alerts as STORED notifications (type `hr`), each sent ONCE per expiry date, from
 * CERTIFICATE_ALERT_DAYS (30) days before the expiry (company calendar day, regional timezone):
 * to the employee (when they have a login), their manager and every HR full user of the company.
 * Marks hr_certificates.expiry_notified_at; changing the issue / expiry date clears it (re-armed).
 * Runs lazily per company: GET /alerts and the training endpoints call it for the caller's company.
 */

export const certificateLink = (id: string) => `/hr/training?tab=certificates&certificate=${encodeURIComponent(id)}`

export function runTrainingReminders(companyId: string, at: Date = clockNow()): number {
  // Only for companies with the HR module (plan or platform override).
  try {
    assertModule(companyId, 'hr')
  } catch {
    return 0
  }
  const today = companyDayOf(companyId, at).today
  const stamp = at.toISOString()
  let sent = 0
  for (const c of hrCertificates) {
    if (c.companyId !== companyId || !c.expiryDate || c.expiryNotifiedAt) continue
    const left = daysBetweenIso(today, c.expiryDate)
    if (left > CERTIFICATE_ALERT_DAYS) continue
    const emp = hrEmployees.find((e) => e.companyId === companyId && e.id === c.employeeId)
    const course = hrCourses.find((x) => x.companyId === companyId && x.id === c.courseId)
    c.expiryNotifiedAt = stamp
    if (!emp || emp.status === 'terminated') continue
    const manager = emp.managerId ? hrEmployees.find((e) => e.companyId === companyId && e.id === emp.managerId) : undefined
    const ids = new Set<string>()
    if (emp.userId) ids.add(emp.userId)
    if (manager?.userId) ids.add(manager.userId)
    for (const u of users) if (u.companyId === companyId && u.active !== false && scopeOf(u.role, 'hr') === 'full') ids.add(u.id)
    const when = left < 0 ? 'has expired' : left === 0 ? 'expires today' : `expires in ${left} day${left === 1 ? '' : 's'}`
    for (const userId of ids) {
      const u = users.find((x) => x.id === userId && x.companyId === companyId && x.active !== false)
      if (!u) continue
      const whose = userId === emp.userId ? 'Your' : `${emp.fullName}’s`
      pushNotification({ companyId, userId, type: 'hr', title: `${whose} ${course?.title ?? 'training'} certificate ${when}`, body: `Certificate ${c.number} · expiry ${c.expiryDate}`, link: certificateLink(c.id), at: stamp })
      sent++
    }
  }
  return sent
}
