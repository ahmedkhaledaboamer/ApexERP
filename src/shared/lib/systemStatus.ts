import type { StatusOption } from '@/modules/settings/types'

/**
 * Keys of the built-in statuses the lead-journey automation refers to (spec section 4). Built-in
 * statuses can be renamed, reordered and deactivated but never removed, so these keys are stable;
 * labels, order, probability and open/closed meaning always come from `useLookups()`.
 * The mock store (src/shared/mocks/data/lookups.ts) re-exports this same object.
 */
export const SYSTEM_STATUS = {
  new: 'New',
  contacted: 'Contacted',
  noResponse: 'No response',
  callLater: 'Call later',
  interested: 'Interested',
  meeting: 'Meeting',
  proposal: 'Proposal',
  cold: 'Cold',
  won: 'Won',
  lost: 'Lost',
  notInterested: 'Not interested',
} as const

/**
 * Sending a quotation moves a lead to Proposal when its status is open and ordered before
 * Proposal (same rule as the server). `status` is `useLookups().status`.
 */
export function movesToProposal(status: (key: string) => StatusOption, key: string): boolean {
  const proposal = status(SYSTEM_STATUS.proposal)
  const current = status(key)
  return proposal.active && current.kind === 'open' && current.order < proposal.order
}
