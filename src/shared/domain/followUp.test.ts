import { describe, expect, it } from 'vitest'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { daysLate, followUpStateOn, isIsoDate, toFollowUpDate } from '@/shared/domain/followUp'

/**
 * Lead follow-ups are company-local calendar dates. "Today" is the company's today, so the same
 * instant can be "today" for one tenant and "overdue" for another.
 */

/** 2026-11-18 19:30 UTC = 23:30 in Dubai (UTC+4). */
const DUBAI_2330 = new Date('2026-11-18T19:30:00Z')
/** 2026-11-18 20:30 UTC = 00:30 (next day) in Dubai, 23:30 in Riyadh (UTC+3), 22:30 in Cairo (UTC+2). */
const DUBAI_0030 = new Date('2026-11-18T20:30:00Z')

describe('follow-up date state (company-local calendar dates)', () => {
  it('around midnight: 23:30 vs 00:30 company time', () => {
    const before = todayIsoIn('Asia/Dubai', DUBAI_2330)
    const after = todayIsoIn('Asia/Dubai', DUBAI_0030)
    expect(before).toBe('2026-11-18')
    expect(after).toBe('2026-11-19')
    // A follow-up on the 18th is due today until midnight, overdue from 00:00.
    expect(followUpStateOn('2026-11-18', before)).toBe('today')
    expect(followUpStateOn('2026-11-18', after)).toBe('overdue')
    expect(daysLate('2026-11-18', after)).toBe(1)
    // One on the 19th turns from upcoming into today at midnight.
    expect(followUpStateOn('2026-11-19', before)).toBe('upcoming')
    expect(followUpStateOn('2026-11-19', after)).toBe('today')
  })

  it('the same instant gives different answers in Dubai, Riyadh and Cairo', () => {
    const dubai = todayIsoIn('Asia/Dubai', DUBAI_0030)
    const riyadh = todayIsoIn('Asia/Riyadh', DUBAI_0030)
    const cairo = todayIsoIn('Africa/Cairo', DUBAI_0030)
    expect([dubai, riyadh, cairo]).toEqual(['2026-11-19', '2026-11-18', '2026-11-18'])
    expect(followUpStateOn('2026-11-18', dubai)).toBe('overdue')
    expect(followUpStateOn('2026-11-18', riyadh)).toBe('today')
    expect(followUpStateOn('2026-11-18', cairo)).toBe('today')
    expect(followUpStateOn('2026-11-19', riyadh)).toBe('upcoming')
    // An hour later (21:30 UTC): Cairo is still on the 18th, Riyadh has moved on.
    const later = new Date('2026-11-18T21:30:00Z')
    expect(followUpStateOn('2026-11-18', todayIsoIn('Asia/Riyadh', later))).toBe('overdue')
    expect(followUpStateOn('2026-11-18', todayIsoIn('Africa/Cairo', later))).toBe('today')
  })

  it('closed leads and empty or malformed values have no follow-up state', () => {
    expect(followUpStateOn('2026-11-18', '2026-11-18', true)).toBe('none')
    expect(followUpStateOn(null, '2026-11-18')).toBe('none')
    expect(followUpStateOn('2026-11-18T09:00:00.000Z', '2026-11-18')).toBe('none')
  })

  it('isIsoDate accepts only real yyyy-MM-dd calendar dates', () => {
    expect(isIsoDate('2026-11-18')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-11-18T09:00:00Z')).toBe(false)
    expect(isIsoDate('18/11/2026')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })

  it('migrates an ISO datetime to the company-local date it falls on', () => {
    expect(toFollowUpDate('2026-11-18T20:30:00.000Z', 'Asia/Dubai')).toBe('2026-11-19')
    expect(toFollowUpDate('2026-11-18T20:30:00.000Z', 'Asia/Riyadh')).toBe('2026-11-18')
    expect(toFollowUpDate('2026-11-18', 'Asia/Dubai')).toBe('2026-11-18')
    expect(toFollowUpDate('not a date', 'Asia/Dubai')).toBeNull()
    expect(toFollowUpDate(null, 'Asia/Dubai')).toBeNull()
  })
})
