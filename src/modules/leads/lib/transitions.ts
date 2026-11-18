import type { StatusOption } from '@/modules/settings/types'

/**
 * What the board does when a lead is dropped on a stage, from that stage's Settings-list entry:
 *  - won: never a plain move; the Won dialog (customer, contract, projects) takes over;
 *  - next-step: the dialog asks for the next step and its date (e.g. Interested, Meeting);
 *  - loss-reason: the dialog asks for a reason from the company's loss-reasons list (Lost, Not interested);
 *  - direct: moved immediately (optimistic, rolled back if the server refuses).
 * The server enforces the same requirements (PATCH /leads/:id/stage), so a client bug can't skip them.
 */
export type MoveAction = 'won' | 'next-step' | 'loss-reason' | 'direct'

export function moveActionFor(target: Pick<StatusOption, 'kind' | 'requires'>): MoveAction {
  if (target.kind === 'won' || target.requires === 'convert') return 'won'
  if (target.requires === 'next-step') return 'next-step'
  if (target.requires === 'loss-reason') return 'loss-reason'
  return 'direct'
}
