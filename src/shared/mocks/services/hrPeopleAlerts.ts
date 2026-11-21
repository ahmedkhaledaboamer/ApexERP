import type { Employee } from '@/modules/hr/types'
import type { DocumentStatus } from '@/modules/hr/peopleTypes'
import { DOCUMENT_TYPE_LABEL, EXPIRY_ALERT_DAYS, WARRANTY_ALERT_DAYS } from '@/modules/hr/peopleTypes'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts, hrDocuments } from '@/shared/mocks/data/hrPeople'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyModules, onLifecycleTick } from '@/shared/mocks/services/billing'
import { now as clockNow } from '@/shared/mocks/clock'
import { hrFullUsers, managerUserOf } from './hrAccess'
import { endExpiredContracts } from './hrContracts'

/**
 * HR reminders as STORED notifications (type `hr-people`), each sent ONCE per record, threshold and date:
 *
 *   document   60 days before its expiry date, and again on / after the expiry date   → HR full + the manager
 *   contract   probation ending within 14 days; contract end within 60 and 30 days      → HR full + the manager
 *   asset      warranty ending within 30 days                                          → HR full
 *
 * The marks (`alertMarks`) are keyed by threshold and date (`d60:2027-01-05`), so changing the date re-arms
 * them (the services also clear the marks on a date change). A threshold already passed when first seen is
 * marked without a second message (a document found expired gets the expiry notice only).
 * Days are the company's calendar (regional timezone, at the mock clock). Runs lazily: on the company's
 * lifecycle tick (every authenticated request) and before HR list reads; only for companies whose plan
 * includes `hr`. Active contracts past their end date become `ended` on the same tick.
 */

export const HR_ALERT_TYPE = 'hr-people'

export function documentStatusOf(expiryDate: string | null, today: string): { status: DocumentStatus; days: number | null } {
  if (!expiryDate) return { status: 'valid', days: null }
  const days = daysBetweenIso(today, expiryDate)
  return { status: days < 0 ? 'expired' : days <= EXPIRY_ALERT_DAYS ? 'expiring' : 'valid', days }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${plural(n, 'day')}`)

export interface HrAlertTick {
  documents: number
  contracts: number
  assets: number
}

function notify(companyId: string, userIds: Set<string>, title: string, body: string, link: string, at: string): void {
  for (const userId of userIds) pushNotification({ companyId, userId, type: HR_ALERT_TYPE, title, body, link, at })
}

function recipients(companyId: string, employee: Employee | undefined, withManager: boolean): Set<string> {
  const ids = new Set(hrFullUsers(companyId).map((u) => u.id))
  if (withManager && employee) {
    const m = managerUserOf(companyId, employee)
    if (m) ids.add(m.id)
  }
  return ids
}

const employeeLink = (id: string, tab: string) => `/hr/employees/${encodeURIComponent(id)}?tab=${tab}`

export function runHrPeopleAlerts(companyId: string, at: Date = clockNow()): HrAlertTick {
  const out: HrAlertTick = { documents: 0, contracts: 0, assets: 0 }
  if (!companyModules(companyId).includes('hr')) return out
  const today = companyDayOf(companyId, at).today
  const stamp = at.toISOString()
  const employee = (id: string) => hrEmployees.find((e) => e.companyId === companyId && e.id === id)
  endExpiredContracts(companyId, today)

  for (const doc of hrDocuments) {
    if (doc.companyId !== companyId || !doc.expiryDate) continue
    const e = employee(doc.employeeId)
    if (!e || e.status === 'terminated') continue
    const left = daysBetweenIso(today, doc.expiryDate)
    const k60 = `d60:${doc.expiryDate}`
    const k0 = `d0:${doc.expiryDate}`
    const label = DOCUMENT_TYPE_LABEL[doc.type]
    if (left <= 0 && !doc.alertMarks.includes(k0)) {
      notify(companyId, recipients(companyId, e, true), left === 0 ? `${label} expires today` : `${label} expired`, `${e.fullName} · ${e.employeeNo}${left < 0 ? ` · expired ${plural(-left, 'day')} ago` : ''}`, employeeLink(e.id, 'documents'), stamp)
      doc.alertMarks.push(k0)
      if (!doc.alertMarks.includes(k60)) doc.alertMarks.push(k60)
      out.documents++
    } else if (left > 0 && left <= EXPIRY_ALERT_DAYS && !doc.alertMarks.includes(k60)) {
      notify(companyId, recipients(companyId, e, true), `${label} expires ${inDays(left)}`, `${e.fullName} · ${e.employeeNo} · renew before ${doc.expiryDate}`, employeeLink(e.id, 'documents'), stamp)
      doc.alertMarks.push(k60)
      out.documents++
    }
  }

  for (const c of hrContracts) {
    if (c.companyId !== companyId || c.status !== 'active') continue
    const e = employee(c.employeeId)
    if (!e) continue
    if (c.probationEndDate) {
      const left = daysBetweenIso(today, c.probationEndDate)
      const key = `p14:${c.probationEndDate}`
      if (left >= 0 && left <= 14 && !c.alertMarks.includes(key)) {
        notify(companyId, recipients(companyId, e, true), `Probation ends ${inDays(left)}`, `${e.fullName} · ${e.employeeNo} · confirm or extend before ${c.probationEndDate}`, employeeLink(e.id, 'contract'), stamp)
        c.alertMarks.push(key)
        out.contracts++
      }
    }
    if (c.endDate) {
      const left = daysBetweenIso(today, c.endDate)
      const k60 = `e60:${c.endDate}`
      const k30 = `e30:${c.endDate}`
      const send = (key: string) => {
        notify(companyId, recipients(companyId, e, true), `Contract ends ${inDays(left)}`, `${e.fullName} · ${e.employeeNo} · renew or end it before ${c.endDate}`, employeeLink(e.id, 'contract'), stamp)
        c.alertMarks.push(key)
        out.contracts++
      }
      if (left >= 0 && left <= 30) {
        if (!c.alertMarks.includes(k30)) {
          send(k30)
          if (!c.alertMarks.includes(k60)) c.alertMarks.push(k60)
        }
      } else if (left > 30 && left <= 60 && !c.alertMarks.includes(k60)) send(k60)
    }
  }

  for (const a of hrAssets) {
    if (a.companyId !== companyId || !a.warrantyEnd || a.status === 'retired' || a.status === 'lost') continue
    const left = daysBetweenIso(today, a.warrantyEnd)
    const key = `w30:${a.warrantyEnd}`
    if (left >= 0 && left <= WARRANTY_ALERT_DAYS && !a.alertMarks.includes(key)) {
      notify(companyId, recipients(companyId, undefined, false), `Warranty ends ${inDays(left)}`, `${a.tag} · ${a.name}`, `/hr/assets?asset=${encodeURIComponent(a.id)}`, stamp)
      a.alertMarks.push(key)
      out.assets++
    }
  }
  return out
}

onLifecycleTick('hr-people-alerts', (companyId, until) => runHrPeopleAlerts(companyId, new Date(until)))
