import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { AXIS_TICK, C, CURSOR, Meter, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput } from '@/shared/components/form/Field'
import { ErrorText, Section, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { downloadCsv } from '@/modules/platform/csv'
import { toCsv } from '@/modules/hr/reports/calc'
import { fmtDate } from '@/shared/lib/utils'
import { engagementApi, useSurveyResults } from '../api'
import { DRIVER_LABEL, QUESTION_TYPE_LABEL, SURVEY_KIND_LABEL, TENURE_BANDS, TENURE_LABEL, type GroupResult, type SurveyResults, type TenureBand, type TrendPoint } from '../types'
import { NotEnough, Stat, SurveyStatusBadge, fmtEnps, fmtRate, fmtScore } from './bits'

/**
 * Results of one survey, as the API shapes them for the caller: HR full (company, breakdowns, export, individuals of a
 * non-anonymous survey) or a Department Head (their departments). One filter at a time; groups under 5 are suppressed.
 */
export function ResultsDrawer({ id, onClose, departments, canExport }: { id: string | null; onClose: () => void; departments: { id: string; name: string }[]; canExport: boolean }) {
  const [filter, setFilter] = useState('')
  const q = filter.startsWith('d:') ? { departmentId: filter.slice(2) } : filter.startsWith('t:') ? { tenureBand: filter.slice(2) as TenureBand } : {}
  const res = useSurveyResults(id, q)
  const r = res.data
  return (
    <Drawer
      open={!!id}
      onClose={() => {
        setFilter('')
        onClose()
      }}
      width="xl"
      title={r ? r.survey.name : 'Results'}
      description={r ? `${SURVEY_KIND_LABEL[r.survey.kind]} · ${fmtDate(r.survey.opensOn)} – ${fmtDate(r.survey.closesOn)} · ${r.survey.anonymous ? 'Anonymous' : 'Confidential (named)'}` : undefined}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">Show</span>
            <SelectInput aria-label="Results for" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-64">
              <option value="">{r?.scope === 'departments' ? 'All my departments' : 'Whole company'}</option>
              <optgroup label="Department">
                {departments.map((d) => (
                  <option key={d.id} value={`d:${d.id}`}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Tenure">
                {TENURE_BANDS.map((b) => (
                  <option key={b} value={`t:${b}`}>
                    {TENURE_LABEL[b]}
                  </option>
                ))}
              </optgroup>
            </SelectInput>
          </label>
          {canExport && id && <ExportButton id={id} />}
        </div>
        {res.error ? <ErrorText error={res.error} /> : !r ? <Skeleton className="h-80" /> : <ResultsBody r={r} />}
      </div>
    </Drawer>
  )
}

function ExportButton({ id }: { id: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const x = await engagementApi.exportRows(id)
          downloadCsv(x.fileName, toCsv(x.headers, x.rows))
          toast.success('CSV downloaded', `${x.rows.length} rows`)
        } catch (e) {
          toast.error('Couldn’t export the results', e instanceof Error ? e.message : 'Try again.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <Download />
      Export CSV
    </Button>
  )
}

export function ResultsBody({ r }: { r: SurveyResults }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted">
        <SurveyStatusBadge status={r.survey.status} />
        <span>{r.scope === 'departments' ? 'Results of the departments you head.' : 'Company-wide results.'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Response rate" value={fmtRate(r.responseRate)} hint={`${r.responseCount} of ${r.targetCount}`} testId="response-rate" />
        <Stat label="eNPS" value={r.suppressed ? '—' : fmtEnps(r.enps?.score)} hint={r.enps ? `${r.enps.promoters} promoters · ${r.enps.detractors} detractors` : undefined} testId="enps-score" />
        <Stat label="Engagement (1–5)" value={r.suppressed ? '—' : fmtScore(r.engagementScore)} />
        <Stat label="Minimum group" value={r.minGroup} hint="Smaller groups are hidden" />
      </div>
      {r.suppressed && <NotEnough min={r.minGroup} responses={r.responseCount} />}
      {r.trend.length > 1 && <TrendChart trend={r.trend} />}
      {!r.suppressed && r.drivers.length > 0 && (
        <Section title="Drivers">
          <SimpleTable label="Driver scores" head={['Driver', 'Score (1–5)', 'Favourable', '']}>
            {r.drivers.map((d) => (
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
        </Section>
      )}
      {(r.byDepartment.length > 0 || r.byTenure.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {r.byDepartment.length > 0 && <Breakdown title="By department" rows={r.byDepartment} min={r.minGroup} />}
          {r.byTenure.length > 0 && <Breakdown title="By tenure" rows={r.byTenure} min={r.minGroup} />}
        </div>
      )}
      {!r.suppressed &&
        r.questions
          .filter((q) => q.type !== 'text')
          .map((q) => (
            <Section key={q.questionId} title={q.text}>
              <p className="text-xs text-muted">
                {QUESTION_TYPE_LABEL[q.type]} · {q.responses} answers{q.average !== null ? ` · average ${q.average.toFixed(2)}` : ''}
              </p>
              <div className="h-40" aria-label={`Answers to ${q.text}`}>
                <ResponsiveContainer>
                  <BarChart data={q.distribution} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={AXIS_TICK} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Answers" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          ))}
      {!r.suppressed && r.themes.length > 0 && (
        <Section title="Comment themes">
          <ul className="space-y-2">
            {r.themes.map((t) => (
              <li key={t.theme} className="rounded-lg border border-line bg-surface p-3">
                <p className="text-[0.8125rem] font-medium text-ink">
                  {t.label} <span className="text-xs font-normal text-muted">· {t.count}</span>
                </p>
                {t.examples.map((x, i) => (
                  <p key={i} className="mt-1 text-xs text-ink-2">
                    “{x}”
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!r.suppressed &&
        r.questions
          .filter((q) => q.type === 'text' && q.comments.length > 0)
          .map((q) => (
            <Section key={q.questionId} title={`Comments · ${q.text}`}>
              <ul className="space-y-1 text-[0.8125rem] text-ink-2" aria-label="Comments (no names)">
                {q.comments.map((c, i) => (
                  <li key={i}>“{c}”</li>
                ))}
              </ul>
            </Section>
          ))}
      {r.individual && (
        <Section title="Individual answers (confidential survey, HR only)">
          <SimpleTable label="Individual answers" head={['Employee', 'Department', 'Submitted', ...r.survey.questions.map((q) => q.text)]}>
            {r.individual.map((i) => (
              <tr key={i.employeeName}>
                <td className={td}>{i.employeeName}</td>
                <td className={td}>{i.departmentName ?? '—'}</td>
                <td className={td}>{fmtDate(i.submittedOn)}</td>
                {i.answers.map((a) => (
                  <td key={a.questionId} className={td}>
                    {a.display || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </SimpleTable>
        </Section>
      )}
      {r.survey.journeyId && <p className="text-xs text-muted">Linked to the offboarding journey {r.survey.journeyId}.</p>}
    </div>
  )
}

function Breakdown({ title, rows, min }: { title: string; rows: GroupResult[]; min: number }) {
  return (
    <Section title={title}>
      <SimpleTable label={title} head={['Group', 'Responses', 'eNPS', 'Score']}>
        {rows.map((g) => (
          <tr key={g.key}>
            <td className={td}>{g.label}</td>
            <td className={`${td} num`}>{g.responses}</td>
            {g.suppressed ? (
              <td className={`${td} text-xs text-muted`} colSpan={2} title={`Hidden: fewer than ${min} responses, or it would let a small group be worked out`}>
                Not enough responses to show
              </td>
            ) : (
              <>
                <td className={`${td} num`}>{fmtEnps(g.enps)}</td>
                <td className={`${td} num`}>{fmtScore(g.score)}</td>
              </>
            )}
          </tr>
        ))}
      </SimpleTable>
    </Section>
  )
}

export function TrendChart({ trend, title = 'Trend across waves' }: { trend: TrendPoint[]; title?: string }) {
  const data = trend.map((p) => ({ name: p.opensOn.slice(0, 7), eNPS: p.enps, responses: p.responses }))
  const hasEnps = trend.some((p) => p.enps !== null)
  return (
    <Section title={title}>
      {hasEnps && (
        <div className="h-44" aria-label="eNPS trend">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={AXIS_TICK} />
              <YAxis domain={[-100, 100]} tickLine={false} axisLine={false} width={36} tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="eNPS" stroke={C.brand} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <SimpleTable label="Waves" head={['Wave', 'Opened', 'Responses', 'Rate', 'eNPS', 'Score']}>
        {trend.map((p) => (
          <tr key={p.surveyId} data-testid="trend-row">
            <td className={td}>{p.name}</td>
            <td className={td}>{fmtDate(p.opensOn)}</td>
            <td className={`${td} num`}>{p.responses}</td>
            <td className={`${td} num`}>{fmtRate(p.responseRate)}</td>
            {p.suppressed ? (
              <td className={`${td} text-xs text-muted`} colSpan={2}>
                Not enough responses to show
              </td>
            ) : (
              <>
                <td className={`${td} num`}>{fmtEnps(p.enps)}</td>
                <td className={`${td} num`}>{fmtScore(p.score)}</td>
              </>
            )}
          </tr>
        ))}
      </SimpleTable>
    </Section>
  )
}
