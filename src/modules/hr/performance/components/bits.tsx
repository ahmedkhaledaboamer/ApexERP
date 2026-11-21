import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { PHASE_LABEL, STAGE_LABEL, type CyclePhase, type ReviewStage } from '../types'

/** Small shared pieces of the Performance screens. */

const STAGE_TONE: Record<ReviewStage, Tone> = { goal_setting: 'sky', self_review: 'blue', manager_review: 'amber', calibration: 'brand', shared: 'teal', acknowledged: 'green', incomplete: 'neutral' }
const PHASE_TONE: Record<CyclePhase, Tone> = { draft: 'neutral', goal_setting: 'sky', self_review: 'blue', manager_review: 'amber', calibration: 'brand', shared: 'teal', closed: 'neutral' }

export const StageBadge = ({ stage }: { stage: ReviewStage }) => <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
export const PhaseBadge = ({ phase }: { phase: CyclePhase }) => <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>

export function RatingText({ value, label, max }: { value: number | null; label: string | null; max: number }) {
  if (value === null) return <span className="text-xs text-subtle">—</span>
  return (
    <span>
      <span className="num font-medium text-ink">{value}</span>
      <span className="text-xs text-muted"> / {max}</span> {label && <span className="text-[0.8125rem] text-ink-2">{label}</span>}
    </span>
  )
}
