import type { LeaveCode, LeaveType } from './types'

/**
 * Synthetic country defaults for leave types and public holidays. They are labour-law-LIKE values
 * for the demo (UAE- and KSA-inspired), labelled "defaults, review with HR" in the UI: not legal
 * advice, not an exact statement of either law. Holiday dates of Islamic holidays are approximate
 * (they follow the moon sighting); HR edits them every year.
 */

export type LeaveTypeDefault = Omit<LeaveType, 'id' | 'isActive' | 'isDefault'>

const COLORS: Record<LeaveCode, string> = {
  annual: '#4f46e5',
  sick: '#e11d48',
  unpaid: '#64748b',
  maternity: '#db2777',
  paternity: '#0891b2',
  hajj: '#059669',
  compassionate: '#7c3aed',
  emergency: '#ea580c',
  other: '#71717a',
}

function t(code: LeaveCode, name: string, rest: Partial<LeaveTypeDefault>): LeaveTypeDefault {
  return {
    code,
    name,
    isPaid: true,
    daysPerYear: 0,
    accrual: 'yearly',
    carryOverMax: 0,
    documentAfterDays: null,
    minNoticeDays: 0,
    gender: null,
    allowNegative: false,
    color: COLORS[code],
    ...rest,
  }
}

/** UAE-like defaults (Apex Aora and every AE company). */
const AE: LeaveTypeDefault[] = [
  t('annual', 'Annual leave', { daysPerYear: 30, accrual: 'monthly', carryOverMax: 10, minNoticeDays: 7 }),
  t('sick', 'Sick leave', { daysPerYear: 15, documentAfterDays: 2 }),
  t('unpaid', 'Unpaid leave', { isPaid: false, daysPerYear: 30, allowNegative: true, minNoticeDays: 7 }),
  t('maternity', 'Maternity leave', { daysPerYear: 60, gender: 'female', minNoticeDays: 14, documentAfterDays: 0 }),
  t('paternity', 'Paternity leave', { daysPerYear: 5, gender: 'male' }),
  t('hajj', 'Hajj leave', { isPaid: false, daysPerYear: 30, minNoticeDays: 30 }),
  t('compassionate', 'Compassionate leave', { daysPerYear: 5 }),
  t('emergency', 'Emergency leave', { daysPerYear: 3 }),
  t('other', 'Other leave', { isPaid: false, daysPerYear: 0, allowNegative: true, minNoticeDays: 3 }),
]

/** KSA-like defaults (Crest Logistics and every SA company). */
const SA: LeaveTypeDefault[] = [
  t('annual', 'Annual leave', { daysPerYear: 21, accrual: 'monthly', carryOverMax: 5, minNoticeDays: 14 }),
  t('sick', 'Sick leave', { daysPerYear: 30, documentAfterDays: 1 }),
  t('unpaid', 'Unpaid leave', { isPaid: false, daysPerYear: 20, allowNegative: true, minNoticeDays: 14 }),
  t('maternity', 'Maternity leave', { daysPerYear: 70, gender: 'female', minNoticeDays: 14, documentAfterDays: 0 }),
  t('paternity', 'Paternity leave', { daysPerYear: 3, gender: 'male' }),
  t('hajj', 'Hajj leave', { daysPerYear: 10, minNoticeDays: 30 }),
  t('compassionate', 'Compassionate leave', { daysPerYear: 5 }),
  t('emergency', 'Emergency leave', { daysPerYear: 3 }),
  t('other', 'Other leave', { isPaid: false, daysPerYear: 0, allowNegative: true, minNoticeDays: 3 }),
]

export function defaultLeaveTypes(country: string): LeaveTypeDefault[] {
  return (country === 'SA' ? SA : AE).map((x) => ({ ...x }))
}

type HolidaySeed = [date: string, name: string]

/** Approximate public holidays (synthetic; Islamic dates shift with the moon sighting). */
const HOLIDAYS: Record<'AE' | 'SA', Record<number, HolidaySeed[]>> = {
  AE: {
    2026: [
      ['2026-01-01', 'New Year’s Day'],
      ['2026-03-19', 'Eid al-Fitr'],
      ['2026-03-20', 'Eid al-Fitr holiday'],
      ['2026-03-21', 'Eid al-Fitr holiday'],
      ['2026-05-26', 'Arafat Day'],
      ['2026-05-27', 'Eid al-Adha'],
      ['2026-05-28', 'Eid al-Adha holiday'],
      ['2026-06-16', 'Islamic New Year'],
      ['2026-08-25', 'Prophet’s Birthday'],
      ['2026-12-01', 'Commemoration Day'],
      ['2026-12-02', 'UAE National Day'],
      ['2026-12-03', 'UAE National Day holiday'],
    ],
    2027: [
      ['2027-01-01', 'New Year’s Day'],
      ['2027-03-09', 'Eid al-Fitr'],
      ['2027-03-10', 'Eid al-Fitr holiday'],
      ['2027-03-11', 'Eid al-Fitr holiday'],
      ['2027-05-15', 'Arafat Day'],
      ['2027-05-16', 'Eid al-Adha'],
      ['2027-05-17', 'Eid al-Adha holiday'],
      ['2027-06-06', 'Islamic New Year'],
      ['2027-08-14', 'Prophet’s Birthday'],
      ['2027-12-01', 'Commemoration Day'],
      ['2027-12-02', 'UAE National Day'],
      ['2027-12-03', 'UAE National Day holiday'],
    ],
  },
  SA: {
    2026: [
      ['2026-02-22', 'Founding Day'],
      ['2026-03-19', 'Eid al-Fitr break'],
      ['2026-03-22', 'Eid al-Fitr break'],
      ['2026-03-23', 'Eid al-Fitr break'],
      ['2026-05-25', 'Eid al-Adha break'],
      ['2026-05-26', 'Eid al-Adha break'],
      ['2026-05-27', 'Eid al-Adha break'],
      ['2026-05-28', 'Eid al-Adha break'],
      ['2026-09-23', 'Saudi National Day'],
    ],
    2027: [
      ['2027-02-22', 'Founding Day'],
      ['2027-03-09', 'Eid al-Fitr break'],
      ['2027-03-10', 'Eid al-Fitr break'],
      ['2027-03-11', 'Eid al-Fitr break'],
      ['2027-05-16', 'Eid al-Adha break'],
      ['2027-05-17', 'Eid al-Adha break'],
      ['2027-05-18', 'Eid al-Adha break'],
      ['2027-09-23', 'Saudi National Day'],
    ],
  },
}

/** The country's default holidays of a year (the latest seeded year's pattern when the year isn't listed). */
export function defaultHolidays(country: string, year: number): { date: string; name: string }[] {
  const table = HOLIDAYS[country === 'SA' ? 'SA' : 'AE']
  const own = table[year]
  if (own) return own.map(([date, name]) => ({ date, name }))
  // Fixed-date holidays only, for years outside the table.
  const fixed = country === 'SA' ? [['02-22', 'Founding Day'], ['09-23', 'Saudi National Day']] : [['01-01', 'New Year’s Day'], ['12-02', 'UAE National Day']]
  return fixed.map(([md, name]) => ({ date: `${year}-${md}`, name }))
}
