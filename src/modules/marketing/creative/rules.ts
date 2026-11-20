import type { Role } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import type { ContentItem, ContentStatus } from './types'

/**
 * Client copy of the content calendar's status rules (the API enforces them: services/
 * contentCalendar.ts). Used by the board to explain a refused drag before calling the server.
 * Returns why `item` can't move to `to`, or null.
 */
export function contentMoveProblem(item: Pick<ContentItem, 'status' | 'ownerId' | 'publishAt'>, to: ContentStatus, user: { id: string; role: Role }, nowMs = Date.now()): string | null {
  if (!can(user.role, 'marketing', 'edit')) return 'Your role can view marketing but not change it.'
  const from = item.status
  if (from === to) return null
  if (from === 'published' && to !== 'archived') return 'Published content can only be archived.'
  if (from === 'archived' && to !== 'idea' && to !== 'draft') return 'Restore archived content as an idea or a draft first.'
  if (to === 'approved') {
    if (from !== 'in_review' && from !== 'scheduled') return 'Send it for review before approving it.'
    if (from === 'in_review' && item.ownerId === user.id && user.role !== 'Company Admin') return 'You can’t approve your own content. Ask another marketing manager (or a Company Admin).'
  }
  if (to === 'scheduled') {
    if (from !== 'approved') return from === 'in_review' ? 'It needs approval before it can be scheduled.' : 'Only approved content can be scheduled.'
    if (!item.publishAt) return 'Set a publish time before scheduling.'
    if (Date.parse(item.publishAt) <= nowMs) return 'Pick a publish time in the future.'
  }
  if (to === 'published' && from !== 'approved' && from !== 'scheduled') return 'Only approved or scheduled content can be marked published.'
  return null
}
