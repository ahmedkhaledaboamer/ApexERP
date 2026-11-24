import { EyeOff } from 'lucide-react'
import { Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { RELATIONSHIP_LABEL, type FeedbackSummary } from '../types'
import { fmtScore } from './bits'

/** The aggregated 360° summary (groups of 3+, pooled "Others"); names only for HR when the company allows it. */
export function FeedbackSummaryView({ s }: { s: FeedbackSummary }) {
  if (!s.available) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-sunken px-3 py-2 text-xs text-muted" data-testid="feedback-not-available">
          <EyeOff className="size-3.5 shrink-0" aria-hidden />
          {s.reason}
        </p>
        {s.named && <Named s={s} />}
      </div>
    )
  }
  const comps = s.groups[0]?.competencies ?? []
  return (
    <div className="space-y-4" data-testid="feedback-summary">
      <p className="text-xs text-muted">
        {s.responses} colleagues answered. Answers are grouped (at least {s.minGroup} per group) and never shown by name.
      </p>
      <SimpleTable label="Feedback by group" head={['Competency', ...s.groups.map((g) => `${g.label} (${g.responses})`)]}>
        {comps.map((c, i) => (
          <tr key={c.competencyId}>
            <td className={td}>{c.text}</td>
            {s.groups.map((g) => (
              <td key={g.key} className={`${td} num`}>
                {g.suppressed ? '—' : fmtScore(g.competencies[i]?.average)}
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <td className={`${td} font-medium`}>Overall</td>
          {s.groups.map((g) => (
            <td key={g.key} className={`${td} num font-medium`} data-testid={g.key === 'all' ? 'feedback-overall' : undefined}>
              {g.suppressed ? 'Not enough responses' : fmtScore(g.overall)}
            </td>
          ))}
        </tr>
      </SimpleTable>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Strengths">
          <ul className="space-y-1 text-[0.8125rem] text-ink-2">{s.strengths.length ? s.strengths.map((x, i) => <li key={i}>“{x}”</li>) : <li className="text-muted">—</li>}</ul>
        </Section>
        <Section title="To improve">
          <ul className="space-y-1 text-[0.8125rem] text-ink-2">{s.improvements.length ? s.improvements.map((x, i) => <li key={i}>“{x}”</li>) : <li className="text-muted">—</li>}</ul>
        </Section>
      </div>
      {s.named && <Named s={s} />}
    </div>
  )
}

function Named({ s }: { s: FeedbackSummary }) {
  if (!s.named?.length) return null
  return (
    <Section title="By person (HR only, company setting)">
      <SimpleTable label="Feedback by person" head={['Colleague', 'Relationship', 'Strengths', 'To improve']}>
        {s.named.map((n) => (
          <tr key={n.providerName}>
            <td className={td}>{n.providerName}</td>
            <td className={td}>{RELATIONSHIP_LABEL[n.relationship]}</td>
            <td className={td}>{n.strengths || '—'}</td>
            <td className={td}>{n.improvements || '—'}</td>
          </tr>
        ))}
      </SimpleTable>
    </Section>
  )
}
