import { Meter } from '@/modules/reports/components/chartKit'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { ErrorText, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import { useEngOverview } from '../api'
import { DRIVER_LABEL } from '../types'
import { NotEnough, Stat, fmtEnps, fmtRate, fmtScore } from './bits'
import { TrendChart } from './ResultsDrawer'

/**
 * Engagement at a glance (GET /hr/engagement/overview): the latest eNPS and its trend across waves, the latest
 * engagement survey's driver scores, open surveys. HR full: the company; a Department Head: their departments.
 * Used by the Engagement page and by HR Reports › Engagement.
 */
export function EngagementOverviewView({ onOpenSurvey }: { onOpenSurvey?: (id: string) => void }) {
  const q = useEngOverview()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-72" />
  const o = q.data
  const e = o.latestEnps
  const eng = o.latestEngagement
  if (!e && !eng && !o.openSurveys.length) return <EmptyState title="No survey results yet" body="Launch an eNPS pulse or an engagement survey to see results here." />
  return (
    <div className="space-y-6" data-testid="engagement-overview">
      <p className="text-xs text-muted">{o.scope === 'departments' ? 'Results of the departments you head.' : 'Company-wide results.'} Groups with fewer than {o.minGroup} responses are hidden.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Latest eNPS" value={e && !e.suppressed ? fmtEnps(e.enps) : '—'} hint={e ? `${e.name} · ${e.responses} responses` : 'No pulse yet'} testId="latest-enps" />
        <Stat label="eNPS response rate" value={fmtRate(e?.responseRate)} />
        <Stat label="Engagement (1–5)" value={eng && !eng.suppressed ? fmtScore(eng.score) : '—'} hint={eng?.name} />
        <Stat label="Open surveys" value={o.openSurveys.length} />
      </div>
      {o.enpsTrend.length > 0 && <TrendChart trend={o.enpsTrend} title="eNPS across waves" />}
      {eng && (
        <Section title={`Drivers · ${eng.name}`}>
          {eng.suppressed ? (
            <NotEnough min={o.minGroup} responses={eng.responses} />
          ) : (
            <SimpleTable label="Driver scores" head={['Driver', 'Score (1–5)', 'Favourable', '']}>
              {eng.drivers.map((d) => (
                <tr key={d.driver}>
                  <td className={td}>{DRIVER_LABEL[d.driver]}</td>
                  <td className={`${td} num`}>{fmtScore(d.score)}</td>
                  <td className={`${td} num`}>{fmtRate(d.favorablePct)}</td>
                  <td className={`${td} w-40`}>
                    <Meter value={d.favorablePct ?? 0} />
                  </td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </Section>
      )}
      {o.openSurveys.length > 0 && (
        <Section title="Open surveys">
          <SimpleTable label="Open surveys" head={['Survey', 'Closes', 'Response rate']}>
            {o.openSurveys.map((s) => (
              <tr key={s.surveyId}>
                <td className={td}>{onOpenSurvey ? <button type="button" className="text-start text-ink hover:underline" onClick={() => onOpenSurvey(s.surveyId)}>{s.name}</button> : s.name}</td>
                <td className={td}>{fmtDate(s.closesOn)}</td>
                <td className={`${td} num`}>{fmtRate(s.responseRate)}</td>
              </tr>
            ))}
          </SimpleTable>
        </Section>
      )}
    </div>
  )
}
