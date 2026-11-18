import type { StatusOption } from '@/modules/settings/types'

/**
 * What the board does when a lead is dropped on a stage, from that stage's Settings-list entry
 * (its `type` and requirement flags, never its name):
 *  - won: type won; never a plain move; the Won dialog (customer, contract, projects) takes over;
 *  - next-step: requiresNextStep; the dialog asks for the next step and its date (e.g. Interested, Meeting);
 *  - loss-reason: requiresLossReason; the dialog asks for a reason from the loss-reasons list (Lost, Not interested);
 *  - direct: moved immediately (optimistic, rolled back if the server refuses).
 * The server enforces the same requirements (PATCH /leads/:id/stage), so a client bug can't skip them.
 */
export type MoveAction = 'won' | 'next-step' | 'loss-reason' | 'direct'

export function moveActionFor(target: Pick<StatusOption, 'type' | 'requiresNextStep' | 'requiresLossReason'>): MoveAction {
  if (target.type === 'won') return 'won'
  if (target.requiresLossReason) return 'loss-reason'
  if (target.requiresNextStep) return 'next-step'
  return 'direct'
}
