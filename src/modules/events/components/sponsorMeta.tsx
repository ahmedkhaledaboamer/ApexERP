import type { SponsorDeal, SponsorPackage, SponsorStage } from '@/modules/events/sponsorTypes'
import { OPEN_SPONSOR_STAGES, SPONSOR_STAGE_LABEL, WON_SPONSOR_STAGES } from '@/modules/events/sponsorTypes'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

export const SPONSOR_STAGE_TONE: Record<SponsorStage, Tone> = {
  prospect: 'neutral',
  contacted: 'sky',
  proposal_sent: 'blue',
  negotiating: 'amber',
  signed: 'brand',
  paid: 'green',
  lost: 'red',
}

export function SponsorStageBadge({ stage }: { stage: SponsorStage }) {
  return (
    <Badge tone={SPONSOR_STAGE_TONE[stage]} variant="dot">
      {SPONSOR_STAGE_LABEL[stage]}
    </Badge>
  )
}

/**
 * Why a move is refused, before asking the server (same rules as services/eventSponsors.ts stageProblem +
 * the sold-out rule); null = allowed. Lost needs a reason: the page asks for it.
 */
export function sponsorMoveProblem(deal: Pick<SponsorDeal, 'stage' | 'packageId'>, to: SponsorStage, packages: SponsorPackage[]): string | null {
  const from = deal.stage
  if (from === to || to === 'lost') return null
  if (from === 'lost') return OPEN_SPONSOR_STAGES.includes(to) ? null : 'Reopen the sponsor (move it to an open stage) before signing.'
  if (to === 'paid' && from !== 'signed') return 'Mark the sponsor signed before paid.'
  if (WON_SPONSOR_STAGES.includes(from) && OPEN_SPONSOR_STAGES.includes(to)) return 'A signed sponsor can only be marked paid or lost.'
  if (to === 'signed' && !WON_SPONSOR_STAGES.includes(from)) {
    const p = packages.find((x) => x.id === deal.packageId)
    if (p && p.remaining <= 0) return `${p.name} is sold out (${p.quantity} of ${p.quantity} signed). Raise the quantity or pick another package.`
  }
  return null
}

export const offsetLabel = (n: number) => (n === 0 ? 'On the day' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} before` : `${n} day${n === 1 ? '' : 's'} after`)
