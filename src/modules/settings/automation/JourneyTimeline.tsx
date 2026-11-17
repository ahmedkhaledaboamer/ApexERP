import type { ReactNode } from 'react'
import { BellRing, ChevronRight, Route, RotateCcw } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { DOT, type Tone } from '@/shared/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import type { AutomationRules } from '@/modules/settings/types'

type StatusInfo = (key: string) => { label: string; tone: Tone }

/** Most attempt dots drawn before collapsing into "…". */
const MAX_DOTS = 8

const N = ({ children }: { children: ReactNode }) => <b className="num font-semibold text-ink">{children}</b>
const d = (n: number) => (n === 1 ? 'day' : 'days')

/**
 * The lead journey drawn from the automation numbers being edited:
 * New → reminder → Contacted → No response → follow-ups every X days → Cold after N attempts,
 * plus the stalled-Interested alert and the Lost reopen.
 */
export function JourneyTimeline({ rules, status }: { rules: AutomationRules; status: StatusInfo }) {
  const ok = (n: number) => Number.isFinite(n) && n >= 0
  const a = ok(rules.noContactReminderDays) ? rules.noContactReminderDays : 0
  const gap = ok(rules.noResponseFollowUpDays) ? rules.noResponseFollowUpDays : 0
  const attempts = ok(rules.attemptsBeforeCold) ? rules.attemptsBeforeCold : 0
  const stalled = ok(rules.stalledInterestedDays) ? rules.stalledInterestedDays : 0
  const reopen = ok(rules.lostReopenDays) ? rules.lostReopenDays : 0
  const shown = Math.min(attempts, MAX_DOTS)
  const followUpDays = Math.max(0, attempts - 1) * gap

  return (
    <Card>
      <CardHeader
        icon={<Route />}
        title="Lead journey at a glance"
        description="What happens on its own with the numbers below. Updates as you change them."
      />
      <CardBody className="space-y-5">
        <ol className="flex flex-col gap-1 md:flex-row md:items-center md:gap-0" aria-label="Lead journey">
          <Node status={status('New')} sub="Day 0" />
          <Edge>
            No contact for <N>{a}</N> {d(a)} → reminder
          </Edge>
          <Node status={status('Contacted')} sub="First attempt" />
          <Edge>No reply</Edge>
          <Node status={status('No response')} sub={`Next try in ${gap} ${d(gap)}`} />
          <Edge
            extra={
              <span className="flex items-center gap-1" aria-hidden>
                {Array.from({ length: shown }, (_, i) => (
                  <span key={i} className="size-1.5 rounded-full bg-warning-500" />
                ))}
                {attempts > shown && <span className="text-[0.625rem] leading-none text-muted">…</span>}
              </span>
            }
          >
            <N>{attempts}</N> {attempts === 1 ? 'attempt' : 'attempts'}, every <N>{gap}</N> {d(gap)}
          </Edge>
          <Node status={status('Cold')} sub={attempts ? `≈ ${followUpDays} ${d(followUpDays)} of follow-ups` : 'Right away'} />
        </ol>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Branch
            from={status('Interested')}
            icon={<BellRing aria-hidden />}
            to="Sales manager alerted"
            label={
              <>
                No activity for <N>{stalled}</N> {d(stalled)}
              </>
            }
          />
          <Branch
            from={status('Lost')}
            icon={<RotateCcw aria-hidden />}
            to="Back to the owner to retry"
            label={
              <>
                After <N>{reopen}</N> {d(reopen)}
              </>
            }
          />
        </div>
      </CardBody>
    </Card>
  )
}

function Chip({ status }: { status: { label: string; tone: Tone } }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap text-ink">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[status.tone])} />
      {status.label}
    </span>
  )
}

function Node({ status, sub }: { status: { label: string; tone: Tone }; sub: string }) {
  return (
    <li className="shrink-0">
      <div className="inline-flex flex-col rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-xs">
        <Chip status={status} />
        <span className="text-[0.6875rem] whitespace-nowrap text-muted">{sub}</span>
      </div>
    </li>
  )
}

/** Arrow between two nodes: vertical with the label beside it on phones, horizontal with the label above on wider screens. */
function Edge({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 ps-4 md:min-w-[6.5rem] md:flex-1 md:flex-col md:items-stretch md:gap-1 md:px-1.5 md:ps-1.5">
      <span aria-hidden className="h-6 w-px shrink-0 bg-line-strong md:hidden" />
      <span className="flex flex-col gap-1 text-[0.6875rem] leading-tight text-muted md:items-center md:text-center">
        {extra}
        <span>{children}</span>
      </span>
      <span aria-hidden className="relative hidden h-px bg-line-strong md:block">
        <ChevronRight className="absolute -end-1.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
      </span>
    </li>
  )
}

function Branch({ from, label, to, icon }: { from: { label: string; tone: Tone }; label: ReactNode; to: string; icon: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-sunken/50 px-3 py-2.5">
      <Chip status={from} />
      <ChevronRight className="size-3.5 text-subtle" aria-hidden />
      <span className="text-[0.75rem] text-muted">{label}</span>
      <ChevronRight className="size-3.5 text-subtle" aria-hidden />
      <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink [&_svg]:size-3.5 [&_svg]:text-brand-600 dark:[&_svg]:text-brand-300">
        {icon}
        {to}
      </span>
    </div>
  )
}
