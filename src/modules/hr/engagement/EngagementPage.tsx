import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HeartPulse, Plus } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Switch } from '@/shared/components/form/Field'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ErrorText, FormError, SimpleTable, td } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import { engagementApi, useEngOptions, useEngWrite, useMySurveys, useSurveys } from './api'
import { RECURRENCE_LABEL, SURVEY_KIND_LABEL, type EngagementOptions, type MySurveyRow, type Survey } from './types'
import { AnswerSurveyDrawer } from './components/AnswerSurveyDrawer'
import { ResultsDrawer } from './components/ResultsDrawer'
import { SurveyEditorDrawer } from './components/SurveyEditorDrawer'
import { EngagementOverviewView } from './components/OverviewView'
import { SurveyStatusBadge, fmtRate } from './components/bits'
import { useNewParam } from '@/shared/hooks/useNewParam'

type Tab = 'my' | 'overview' | 'surveys' | 'settings'

/**
 * `/hr/engagement`: "My surveys" for every employee (whatever their `hr` scope: answering is self-service), the
 * overview and the surveys with results for HR full and Department Heads (their departments, aggregated), survey
 * creation and settings for HR full. ?answer=<survey> opens the answer form, ?survey=<id> the results.
 */
export default function EngagementPage() {
  const options = useEngOptions()
  const [params, setParams] = useSearchParams()
  const o = options.data
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [{ id: 'my', label: 'My surveys' }]
    if (o?.results) t.push({ id: 'overview', label: 'Overview' }, { id: 'surveys', label: 'Surveys & results' })
    if (o?.manage) t.push({ id: 'settings', label: 'Settings' })
    return t
  }, [o])
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? (o?.results && !params.get('answer') ? 'overview' : 'my')) as Tab
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: !!o?.manage })
  return (
    <>
      <PageHeader
        icon={<IconTile><HeartPulse /></IconTile>}
        title="Engagement"
        description="Engagement surveys and eNPS pulses: anonymous by default, results only for groups of 5 or more."
        actions={
          o?.manage && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New survey
            </Button>
          )
        }
      />
      <PageBody>
        <Tabs items={tabs} value={tab} onChange={(t) => set({ tab: t })} label="Engagement sections" className="mb-4" />
        {options.isPending ? (
          <Skeleton className="h-60" />
        ) : (
          <>
            {tab === 'my' && <MyTab onOpen={(id) => set({ answer: id })} />}
            {tab === 'overview' && <EngagementOverviewView onOpenSurvey={(id) => set({ survey: id })} />}
            {tab === 'surveys' && o && <SurveysTab o={o} onOpen={(id) => set({ survey: id })} />}
            {tab === 'settings' && o?.settings && <SettingsTab o={o} />}
          </>
        )}
      </PageBody>
      {o?.manage && <SurveyEditorDrawer open={creating} onClose={() => setCreating(false)} o={o} onCreated={() => set({ tab: 'surveys' })} />}
      <AnswerSurveyDrawer id={params.get('answer')} onClose={() => set({ answer: null })} />
      {o?.results && <ResultsDrawer id={params.get('survey')} onClose={() => set({ survey: null })} departments={o.departments} canExport={o.manage} />}
    </>
  )
}

function MyTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useMySurveys()
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-40" />
  const d = q.data
  if (!d.employeeLinked) return <EmptyState icon={<HeartPulse />} title="No employee record" body="Your account isn’t linked to an employee record yet." />
  const row = (r: MySurveyRow) => (
    <tr key={r.surveyId}>
      <td className={td}>
        {r.name}
        <span className="block text-xs text-muted">
          {SURVEY_KIND_LABEL[r.kind]} · {r.anonymous ? 'anonymous' : 'confidential'} · {r.questionCount} questions
        </span>
      </td>
      <td className={td}>{fmtDate(r.closesOn)}</td>
      <td className={td}>
        <Button size="xs" variant={r.responded ? 'secondary' : 'primary'} aria-label={`${r.responded ? (r.editable ? 'Edit answers' : 'View answers') : 'Answer'} · ${r.name}`} onClick={() => onOpen(r.surveyId)}>
          {r.responded ? (r.editable ? 'Edit answers' : 'View') : 'Answer'}
        </Button>
      </td>
    </tr>
  )
  return (
    <div className="space-y-5">
      {d.toAnswer.length === 0 ? (
        <p className="text-[0.8125rem] text-muted">No survey to answer right now. Thank you!</p>
      ) : (
        <SimpleTable label="Surveys to answer" head={['Survey', 'Closes', '']}>
          {d.toAnswer.map(row)}
        </SimpleTable>
      )}
      {d.answered.length > 0 && (
        <>
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Answered</h3>
          <SimpleTable label="Answered surveys" head={['Survey', 'Closes', '']}>
            {d.answered.map(row)}
          </SimpleTable>
        </>
      )}
    </div>
  )
}

function SurveysTab({ o, onOpen }: { o: EngagementOptions; onOpen: (id: string) => void }) {
  const q = useSurveys()
  const toast = useToast()
  const act = useEngWrite((v: { id: string; action: 'launch' | 'close' }) => engagementApi.action(v.id, v.action))
  if (q.error) return <ErrorText error={q.error} />
  if (q.isPending) return <Skeleton className="h-60" />
  if (!q.data.length) return <EmptyState icon={<HeartPulse />} title="No surveys yet" body={o.manage ? 'Create one from a template: an eNPS pulse takes a minute.' : 'No survey reaches your departments yet.'} />
  return (
    <div className="space-y-3">
      <FormError error={act.error} />
      <SimpleTable label="Surveys" head={['Survey', 'Status', 'Dates', 'Responses', '']}>
        {q.data.map((s: Survey) => (
          <tr key={s.id}>
            <td className={td}>
              {s.name}
              <span className="block text-xs text-muted">
                {SURVEY_KIND_LABEL[s.kind]} · {s.anonymous ? 'anonymous' : 'confidential'} · {RECURRENCE_LABEL[s.recurrence]}
                {s.subjectName ? ` · ${s.subjectName}` : ''}
              </span>
            </td>
            <td className={td}>
              <SurveyStatusBadge status={s.status} />
            </td>
            <td className={td}>
              {fmtDate(s.opensOn)} – {fmtDate(s.closesOn)}
            </td>
            <td className={`${td} num`}>
              {s.status === 'draft' || s.status === 'scheduled' ? '—' : `${s.responseCount} / ${s.targetCount} (${fmtRate(s.responseRate)})`}
            </td>
            <td className={`${td} whitespace-nowrap`}>
              <div className="flex gap-1">
                {s.status !== 'draft' && s.status !== 'scheduled' && (
                  <Button size="xs" variant="secondary" aria-label={`Results · ${s.name}`} onClick={() => onOpen(s.id)}>
                    Results
                  </Button>
                )}
                {o.manage && s.status === 'draft' && (
                  <Button size="xs" write aria-label={`Launch · ${s.name}`} loading={act.isPending && act.variables?.id === s.id} onClick={() => act.mutate({ id: s.id, action: 'launch' }, { onSuccess: (x) => toast.success(x.status === 'open' ? 'Survey launched' : 'Survey scheduled', x.name) })}>
                    Launch
                  </Button>
                )}
                {o.manage && (s.status === 'open' || s.status === 'scheduled') && (
                  <Button size="xs" variant="secondary" write aria-label={`Close · ${s.name}`} onClick={() => act.mutate({ id: s.id, action: 'close' }, { onSuccess: (x) => toast.success('Survey closed', x.name) })}>
                    Close
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  )
}

function SettingsTab({ o }: { o: EngagementOptions }) {
  const toast = useToast()
  const save = useEngWrite(engagementApi.saveSettings)
  const s = o.settings!
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Engagement settings" description={`Surveys hide groups under ${s.minSurveyGroup}; 360° feedback pools relationship groups under ${s.minFeedbackGroup}.`} />
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[0.8125rem] text-ink-2">
            HR sees who gave which 360° feedback
            <span className="block text-xs text-muted">Off: feedback is anonymous to everyone, HR included. Managers and employees never see names.</span>
          </p>
          <Switch label="HR sees 360° names" checked={s.feedbackNamesVisibleToHr} onChange={(v) => save.mutate({ feedbackNamesVisibleToHr: v }, { onSuccess: () => toast.success('Settings saved') })} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <p className="text-[0.8125rem] text-ink-2">
            Send the exit survey when an employee moves to notice
            <span className="block text-xs text-muted">Linked to their offboarding journey; answers are seen by HR only.</span>
          </p>
          <Switch label="Automatic exit survey" checked={s.exitSurveyAuto} onChange={(v) => save.mutate({ exitSurveyAuto: v }, { onSuccess: () => toast.success('Settings saved') })} />
        </div>
        <FormError error={save.error} />
      </CardBody>
    </Card>
  )
}
