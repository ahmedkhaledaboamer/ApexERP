import type { Role } from '@/shared/types'
import { scopeOf } from '@/shared/lib/permissions'
import type { AiRecordRef } from './types'

/** Suggested prompts for the empty thread, by what the role can see. */
export function suggestedPrompts(role: Role, hasModule: (m: 'accounting' | 'hr' | 'events') => boolean): string[] {
  const out: string[] = []
  const sales = scopeOf(role, 'sales')
  if (sales !== 'hidden') out.push('What should I follow up today?')
  if (sales === 'own') out.push('Draft a follow-up email to my most overdue lead', 'Summarize my most overdue lead')
  if (sales === 'team' || sales === 'full') out.push('How is the team doing this month?', 'Which quotations are waiting for the client?')
  if (sales === 'view') out.push('How is the pipeline this month?')
  if (hasModule('accounting') && scopeOf(role, 'accounting') !== 'hidden') out.push('Which invoices are overdue?', 'What is our revenue this month?')
  if (hasModule('hr')) out.push(scopeOf(role, 'hr') === 'full' || scopeOf(role, 'hr') === 'team' ? 'Who is on leave next week?' : 'What is my leave balance?')
  if (hasModule('events') && scopeOf(role, 'marketing') !== 'hidden') out.push('How are event registrations going?')
  if (out.length < 3) out.push('What do I have due this week?', 'وش عندي متابعات اليوم؟')
  return [...new Set(out)].slice(0, 6)
}

/** Quick prompts of the "Ask AI" panel on a record page. */
export function recordPrompts(record: AiRecordRef): { label: string; prompt: string }[] {
  if (record.type === 'customer') {
    return [
      { label: 'Summarize', prompt: 'Summarize this customer' },
      { label: 'Draft follow-up', prompt: 'Draft a friendly follow-up email to this customer' },
      { label: 'Contracts', prompt: 'Show the quotations and contracts of this customer' },
    ]
  }
  return [
    { label: 'Summarize', prompt: 'Summarize this lead' },
    { label: 'Draft follow-up', prompt: 'Draft a follow-up email to this lead' },
    { label: 'Suggest services', prompt: 'Suggest services for this lead' },
  ]
}
