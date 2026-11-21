import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, UserPlus } from 'lucide-react'
import type { Application, ApplicationStage, InterviewCard, Opening, OpeningDetail, OpeningStatus } from '@/modules/hr/recruitmentTypes'
import { CANDIDATE_SOURCE_LABEL, INTERVIEW_TYPE_LABEL, PIPELINE_STAGES, STAGE_LABEL } from '@/modules/hr/recruitmentTypes'
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import { useCandidates, useHrScope, useMoveApplication, useMyInterviews, useOpening, useOpeningStatus, useOpenings } from '@/modules/hr/hooks/useTalent'
import { CandidateDrawer, OpeningDrawer, ScorecardModal } from '@/modules/hr/components/RecruitmentForms'
import { ApplicationDrawer } from '@/modules/hr/components/ApplicationDrawer'
import { FormError, OpeningStatusBadge, Score, SimpleTable, StageBadge, STAGE_TONE, errorText, td } from '@/modules/hr/components/talentBits'
import { KanbanBoard } from '@/shared/components/kanban'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'

type Tab = 'openings' | 'candidates' | 'interviews'

/**
 * `/hr/recruitment`: job openings (requests + approval), candidates, the pipeline per opening (Kanban + list),
 * interviews with scorecards, offers and the hire. HR full manages everything; a department head requests
 * openings for their departments and follows them; anyone invited to interview scores from "My interviews".
 */
export default function RecruitmentPage() {
  const scope = useHrScope()
  const [params, setParams] = useSearchParams()
  const openingId = params.get('opening')
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = []
    if (scope === 'full' || scope === 'team') t.push({ id: 'openings', label: 'Openings' }, { id: 'candidates', label: 'Candidates' })
    t.push({ id: 'interviews', label: 'My interviews' })
    return t
  }, [scope])
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0].id) as Tab
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })
  const openOpening = (id: string | null) => setParams(id ? { opening: id } : { tab }, { replace: false })
  const [creating, setCreating] = useState<'opening' | 'candidate' | null>(null)
  const openings = useOpenings(scope === 'full' || scope === 'team')

  if (openingId) return <OpeningView id={openingId} onBack={() => openOpening(null)} />

  return (
    <>
      <PageHeader
        icon={<IconTile><UserPlus /></IconTile>}
        title="Recruitment"
        description="Job openings, candidates and the hiring pipeline. Accepting an offer creates the employee."
        actions={
          <>
            {scope === 'full' && (
              <Button variant="secondary" write onClick={() => setCreating('candidate')}>
                <Plus />
                Add candidate
              </Button>
            )}
            {(scope === 'full' || scope === 'team') && (
              <Button write onClick={() => setCreating('opening')}>
                <Plus />
                {scope === 'full' ? 'New opening' : 'Request opening'}
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        <Tabs items={tabs} value={tab} onChange={setTab} label="Recruitment sections" className="mb-4" />
        {tab === 'openings' && <OpeningsList query={openings} onOpen={openOpening} />}
        {tab === 'candidates' && <CandidatesList />}
        {tab === 'interviews' && <MyInterviews />}
      </PageBody>
      <OpeningDrawer open={creating === 'opening'} onClose={() => setCreating(null)} opening={null} onSaved={(o) => openOpening(o.id)} />
      <CandidateDrawer open={creating === 'candidate'} onClose={() => setCreating(null)} openings={openings.data ?? []} />
    </>
  )
}

function OpeningsList({ query, onOpen }: { query: ReturnType<typeof useOpenings>; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<'active' | 'all'>('active')
  if (query.error) return <ErrorState message={errorText(query.error)} onRetry={() => query.refetch()} />
  if (query.isPending) return <Skeleton className="h-40" />
  const ACTIVE: OpeningStatus[] = ['draft', 'pending_approval', 'open', 'on_hold']
  const rows = (query.data ?? []).filter((o) => status === 'all' || ACTIVE.includes(o.status))
  return (
    <div className="space-y-3">
      <Segmented size="sm" label="Show" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} />
      {rows.length === 0 ? (
        <EmptyState icon={<UserPlus />} title="No openings" body="Create an opening to start hiring." />
      ) : (
        <SimpleTable label="Job openings" head={['Opening', 'Department', 'Status', 'Pipeline', 'Hired', 'Salary range']}>
          {rows.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(o.id)}>
              <td className={td}>
                <button type="button" className="text-start font-medium text-ink hover:underline" onClick={() => onOpen(o.id)}>{o.title}</button>
                <span className="block text-xs text-muted">{[EMPLOYMENT_TYPE_LABEL[o.employmentType], o.location, `HM ${o.hiringManagerName}`].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={td}>{o.departmentName}</td>
              <td className={td}><OpeningStatusBadge status={o.status} /></td>
              <td className={td}>
                <span className="flex gap-1">
                  {PIPELINE_STAGES.map((s) => (
                    <span key={s} title={STAGE_LABEL[s]} aria-label={`${STAGE_LABEL[s]}: ${o.stageCounts[s]}`} className="flex min-w-6 flex-col items-center rounded bg-sunken px-1.5 py-0.5 text-center">
                      <span className="num text-xs font-medium text-ink-2">{o.stageCounts[s]}</span>
                      <span aria-hidden className="text-[0.625rem] leading-tight text-muted">{STAGE_LABEL[s]}</span>
                    </span>
                  ))}
                </span>
              </td>
              <td className={`${td} num`}>{o.hiredCount} / {o.headcount}</td>
              <td className={td}>{salaryRange(o)}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

function salaryRange(o: Opening): string {
  if (!o.salaryVisible) return 'Hidden'
  if (o.salaryMin === null && o.salaryMax === null) return '—'
  const cur = o.salaryCurrency ?? undefined
  return [o.salaryMin, o.salaryMax].filter((x): x is number => x !== null).map((x) => fmtMoney(x, cur)).join(' – ')
}

function CandidatesList() {
  const q = useCandidates()
  const [search, setSearch] = useState('')
  if (q.error) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
  if (q.isPending) return <Skeleton className="h-40" />
  const s = search.trim().toLowerCase()
  const rows = (q.data ?? []).filter((c) => !s || [c.fullName, c.email, c.mobile, c.currentCompany, ...c.tags].join(' ').toLowerCase().includes(s))
  return (
    <div className="space-y-3">
      <input type="search" aria-label="Search candidates" placeholder="Search name, email, tag…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-full max-w-xs rounded-md border border-line-strong bg-surface px-2.5 text-[0.8125rem]" />
      <SimpleTable label="Candidates" head={['Candidate', 'Contact', 'Source', 'Applications', 'CV']}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className={td}>
              <span className="block font-medium text-ink">{c.fullName}</span>
              <span className="block text-xs text-muted">{[c.currentTitle, c.currentCompany].filter(Boolean).join(' · ')}</span>
            </td>
            <td className={td}>
              <span className="block">{c.email || '—'}</span>
              <span className="block text-xs text-muted">{c.mobile}</span>
            </td>
            <td className={td}>{CANDIDATE_SOURCE_LABEL[c.source]}</td>
            <td className={td}>
              <span className="flex flex-col gap-1">
                {c.applications.map((a) => (
                  <span key={a.id} className="flex items-center gap-2 text-xs">{a.openingTitle} <StageBadge stage={a.stage} /></span>
                ))}
              </span>
            </td>
            <td className={td}>{c.cv ? <span className="text-xs">{c.cv.name}</span> : <span className="text-xs text-subtle">—</span>}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  )
}

function MyInterviews() {
  const q = useMyInterviews()
  const [scoring, setScoring] = useState<InterviewCard | null>(null)
  if (q.error) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
  if (q.isPending) return <Skeleton className="h-40" />
  const rows = q.data ?? []
  if (!rows.length) return <EmptyState icon={<UserPlus />} title="No interviews" body="Interviews you are invited to appear here." />
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((i) => (
          <li key={i.id}>
            <Card className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[0.8125rem] font-semibold text-ink">{i.candidateName}</p>
                  <p className="text-xs text-muted">{i.openingTitle}{i.candidateTitle ? ` · now ${i.candidateTitle}` : ''}</p>
                </div>
                <span className="text-xs text-muted">{INTERVIEW_TYPE_LABEL[i.type]}</span>
              </div>
              <p className="text-xs text-ink-2">{fmtDate(i.scheduledAt, 'EEE d MMM yyyy, HH:mm')} · {i.durationMinutes} min{i.location ? ` · ${i.location}` : ''}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">My score: <Score value={i.myScorecard?.average ?? null} /></span>
                {i.status !== 'cancelled' && (
                  <Button size="sm" variant="secondary" write onClick={() => setScoring(i)}>
                    {i.myScorecard ? 'Edit my scorecard' : 'Score interview'}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <ScorecardModal interview={scoring} onClose={() => setScoring(null)} />
    </>
  )
}

/* ---------------- Opening detail ---------------- */

function OpeningView({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useOpening(id)
  const status = useOpeningStatus()
  const move = useMoveApplication()
  const toast = useToast()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [selected, setSelected] = useState<Application | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const back = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft />
      All openings
    </Button>
  )
  if (q.error) return <PageBody>{back}<ErrorState message={errorText(q.error)} /></PageBody>
  if (q.isPending || !q.data) return <PageBody><Skeleton className="h-60" /></PageBody>
  const o: OpeningDetail = q.data
  const active = o.applications.filter((a) => PIPELINE_STAGES.includes(a.stage))
  const setStatus = (s: OpeningStatus) => status.mutate({ id: o.id, input: { status: s } }, { onSuccess: () => toast.success('Opening updated') })

  return (
    <>
      <PageHeader
        icon={<IconTile><UserPlus /></IconTile>}
        title={o.title}
        description={`${o.departmentName} · ${o.hiredCount} of ${o.headcount} hired · hiring manager ${o.hiringManagerName}${o.salaryVisible ? ` · ${salaryRange(o)}` : ''}`}
        actions={
          <>
            {back}
            <OpeningStatusBadge status={o.status} />
            {o.can.approve && <Button write onClick={() => setStatus('open')}>Approve & open</Button>}
            {o.status === 'draft' && <Button write variant="secondary" onClick={() => setStatus(o.can.manageCandidates ? 'open' : 'pending_approval')}>{o.can.manageCandidates ? 'Open' : 'Send for approval'}</Button>}
            {o.can.manageCandidates && o.status === 'open' && <Button write variant="secondary" onClick={() => setStatus('on_hold')}>Put on hold</Button>}
            {o.can.manageCandidates && o.status === 'on_hold' && <Button write variant="secondary" onClick={() => setStatus('open')}>Reopen</Button>}
            {o.can.manageCandidates && o.status !== 'closed' && <Button write variant="ghost" onClick={() => setStatus('closed')}>Close</Button>}
            {o.can.edit && <Button write variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
            {o.can.manageCandidates && o.status === 'open' && (
              <Button write onClick={() => setAdding(true)}>
                <Plus />
                Add candidate
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        <FormError error={status.error} />
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">{o.applicationCount} applications · {active.length} in the pipeline</p>
          <Segmented
            size="sm"
            label="View"
            value={view}
            onChange={setView}
            options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]}
          />
        </div>
        {view === 'board' ? (
          <KanbanBoard<Application, ApplicationStage>
            columns={PIPELINE_STAGES.map((s) => ({ id: s, label: STAGE_LABEL[s], tone: STAGE_TONE[s] }))}
            items={active}
            getId={(a) => a.id}
            getColumn={(a) => a.stage}
            canMove={o.can.moveStages}
            onBlockedMove={() => toast.info('Only HR moves candidates', 'Ask HR to move this candidate on.')}
            onMove={(a, to) => move.mutate({ id: a.id, input: { stage: to } }, { onError: (e) => toast.error('Couldn’t move the candidate', errorText(e)) })}
            emptyLabel="No candidates"
            renderCard={(a) => (
              <button type="button" onClick={() => setSelected(a)} className="block w-full rounded-lg border border-line bg-surface p-3 text-start shadow-xs hover:border-line-strong">
                <span className="block text-[0.8125rem] font-medium text-ink">{a.candidateName}</span>
                <span className="block truncate text-xs text-muted">{[a.candidateTitle, a.candidateCompany].filter(Boolean).join(' · ') || CANDIDATE_SOURCE_LABEL[a.candidateSource]}</span>
                <span className="mt-2 flex items-center justify-between text-xs text-muted">
                  <Score value={a.overallScore} />
                  {a.offerStatus && <span>Offer {a.offerStatus}</span>}
                </span>
              </button>
            )}
          />
        ) : null}
        {(view === 'list' || o.applications.some((a) => !PIPELINE_STAGES.includes(a.stage))) && (
          <div className="mt-4">
            <SimpleTable label="Applications" head={['Candidate', 'Stage', 'Score', 'Interviews', 'Updated']}>
              {(view === 'list' ? o.applications : o.applications.filter((a) => !PIPELINE_STAGES.includes(a.stage))).map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-hover" onClick={() => setSelected(a)}>
                  <td className={td}><span className="font-medium text-ink">{a.candidateName}</span></td>
                  <td className={td}><StageBadge stage={a.stage} /></td>
                  <td className={td}><Score value={a.overallScore} /></td>
                  <td className={`${td} num`}>{a.interviewCount}</td>
                  <td className={td}>{fmtDate(a.stageChangedAt)}</td>
                </tr>
              ))}
            </SimpleTable>
          </div>
        )}
      </PageBody>
      <ApplicationDrawer opening={o} application={selected} onClose={() => setSelected(null)} />
      <OpeningDrawer open={editing} onClose={() => setEditing(false)} opening={o} />
      <CandidateDrawer open={adding} onClose={() => setAdding(false)} openings={[o]} defaultOpeningId={o.id} />
    </>
  )
}
