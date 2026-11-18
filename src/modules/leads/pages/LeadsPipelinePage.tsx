import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { AlertTriangle, Ban, Building2, Clock, Lock, Megaphone, Plus } from 'lucide-react'

import type { LeadStatus } from '@/shared/types'
import type { LeadRow, MoveLeadInput } from '@/modules/leads/types'
import { leadPath } from '@/app/paths'
import { useLeadsQuery, useMoveLeadStage } from '@/modules/leads/hooks/useLeads'
import { StageChangeModal, type PendingMove } from '@/modules/leads/components/StageChangeModal'
import { moveActionFor } from '@/modules/leads/lib/transitions'
import { useOpenWonDialog } from '@/modules/won/hooks'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { categoryMeta } from '@/modules/services/categoryMeta'
import type { Service } from '@/modules/services/types'
import { useLookups, type LookupsApi } from '@/shared/hooks/useLookups'
import { useLeadAlerts } from '@/modules/alerts/hooks/useAlerts'
import { LeadAlertBadges } from '@/modules/alerts/components/LeadAlertBadges'
import type { Alert } from '@/modules/alerts/types'
import { can, departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { buildTree, walk } from '@/modules/departments/lib/tree'
import { cn, fmtCompactMoney } from '@/shared/lib/utils'
import { useAppDispatch, useCurrentUser } from '@/store/hooks'
import { quickAddLeadSet } from '@/store/uiSlice'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, SelectInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { KanbanBoard, KanbanCard, type KanbanColumn } from '@/shared/components/kanban'
import { useRegion } from '@/modules/tenancy/hooks'
import { useReadOnly, useReadOnlyHint } from '@/shared/lib/readOnly'
import { getRegion } from '@/shared/lib/region'

/**
 * Columns = the active statuses in their configured order (Cold shows as a parked column), plus
 * any inactive status that still holds leads so nothing disappears from the board.
 */
function columnsFor(lookups: LookupsApi, leads: LeadRow[]): KanbanColumn<LeadStatus>[] {
  const used = new Set(leads.map((l) => l.status))
  const list = lookups.all.statuses.filter((s) => s.active || used.has(s.key))
  const known = new Set(list.map((s) => s.key))
  const orphans = [...used].filter((k) => !known.has(k)).map((k) => lookups.status(k))
  return [...list, ...orphans].map((s) => ({
    id: s.key,
    label: s.active ? s.label : `${s.label} (inactive)`,
    tone: s.tone,
    meta: s.kind === 'parked' ? 'Parked' : `${s.probability}%`,
  }))
}

export default function LeadsPipelinePage() {
  const user = useCurrentUser()
  const readOnly = useReadOnly()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState
          title="The pipeline isn’t part of your role"
          body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`}
        />
      </PageBody>
    )
  }
  const readOnlyHint = useReadOnlyHint()
  // Why leads can't be moved right now (null = they can). Shown as the hint and when a drop is refused.
  const blockedReason = !can(user.role, 'sales', 'edit')
    ? `Your role (${user.role}) can view the pipeline but not move leads. Ask a manager or your Company Admin.`
    : readOnly
      ? readOnlyHint
      : null
  return <Pipeline blockedReason={blockedReason} canCreate={can(user.role, 'sales', 'create')} />
}

function Pipeline({ blockedReason, canCreate }: { blockedReason: string | null; canCreate: boolean }) {
  const canMove = blockedReason === null
  const region = useRegion()
  const dispatch = useAppDispatch()
  const query = useLeadsQuery()
  const move = useMoveLeadStage()
  const toast = useToast()
  const lookups = useLookups()
  const catalog = useCatalog()
  const leadAlerts = useLeadAlerts()
  const [pending, setPending] = useState<PendingMove | null>(null)
  const openWon = useOpenWonDialog()
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('')
  const [department, setDepartment] = useState('')
  const users = useUsersQuery()
  const departments = useDepartmentsQuery(true)

  const all = useMemo(() => query.data ?? [], [query.data])
  // Department filter: the owner's department (User.departmentId) or any of its sub-departments.
  const deptOfOwner = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.departmentId])), [users.data])
  const deptOptions = useMemo(() => {
    const used = new Set(all.map((l) => deptOfOwner.get(l.ownerId)).filter(Boolean))
    const rows = departments.data ?? []
    const out: { id: string; label: string }[] = []
    walk(buildTree(rows, (a, b) => a.name.localeCompare(b.name)), (t) => {
      // Offer a department when someone in it (or below it) owns a lead on the board.
      if (departmentSubtree(t.node.id, rows).some((id) => used.has(id)) || t.node.id === department)
        out.push({ id: t.node.id, label: `${'  '.repeat(t.depth)}${t.node.name}${t.node.active ? '' : ' (inactive)'}` })
    })
    return out
  }, [all, deptOfOwner, departments.data, department])
  const deptIds = useMemo(
    () => (department ? new Set(departmentSubtree(department, departments.data ?? [])) : null),
    [department, departments.data],
  )
  const inDept = useMemo(
    () => (deptIds ? all.filter((l) => deptIds.has(deptOfOwner.get(l.ownerId) ?? '')) : all),
    [all, deptIds, deptOfOwner],
  )
  const owners = useMemo(() => [...new Set(inDept.map((l) => l.ownerName))].sort(), [inDept])
  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inDept.filter(
      (l) =>
        (!owner || l.ownerName === owner) &&
        (!q || [l.company, l.contactName, l.id, l.industry, l.sourceDetail].join(' ').toLowerCase().includes(q)),
    )
  }, [inDept, search, owner])

  function runMove(input: MoveLeadInput, company: string) {
    move.mutate(input, {
      onSuccess: () => toast.success(`${company} moved to ${lookups.statusLabel(input.status)}`),
      onError: (e) => toast.error('Move not saved', e.message),
    })
  }

  function onMove(lead: LeadRow, to: LeadStatus) {
    const action = moveActionFor(lookups.status(to))
    // Won never moves the stage directly: the card stays put and the Won dialog takes over.
    if (action === 'won') openWon(lead.id)
    else if (action === 'direct') runMove({ id: lead.id, status: to }, lead.company)
    else setPending({ lead, to })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Sales pipeline"
        description={`Drag leads across stages. Values are in ${region.currency}.`}
        actions={
          canCreate && (
            <Button write size="lg" onClick={() => dispatch(quickAddLeadSet(true))}>
              <Plus />
              New lead
            </Button>
          )
        }
      />

      <PageBody className="space-y-5 pb-0">
        <Kpis leads={items} loading={query.isPending || lookups.isLoading} lookups={lookups} />

        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            aria-label="Search leads"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads or companies…"
            className="w-full sm:w-96 [&_input]:h-10 [&_input]:rounded-lg [&_input]:text-[0.875rem]"
          />
          {(deptOptions.length > 1 || department) && (
            <div className="w-52">
              <SelectInput
                aria-label="Department"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value)
                  setOwner('')
                }}
                className="h-10 text-[0.875rem]"
              >
                <option value="">All departments</option>
                {deptOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </SelectInput>
            </div>
          )}
          <div className="w-52">
            <SelectInput aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 text-[0.875rem]">
              <option value="">All agents</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectInput>
          </div>
          <p id="pipeline-hint" data-can-move={canMove} className="ms-auto hidden text-[0.8125rem] text-muted lg:block">
            {canMove ? (
              'Tip: drag with the mouse, or focus a card and use Space + arrow keys'
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden /> View only: {blockedReason}
              </span>
            )}
          </p>
        </div>
      </PageBody>

      {query.isPending || lookups.isLoading ? (
        <BoardSkeleton />
      ) : query.isError ? (
        <PageBody>
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        </PageBody>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto px-4 pt-5 pb-6 sm:px-6 lg:px-10">
          <KanbanBoard
            columns={columnsFor(lookups, all)}
            items={items}
            getId={(l) => l.id}
            getColumn={(l) => l.status}
            onMove={onMove}
            canMove={canMove}
            onBlockedMove={(lead) => toast.error(`${lead.company} wasn’t moved`, blockedReason ?? undefined)}
            emptyLabel={canMove ? 'Drop a lead here' : 'No leads'}
            summarize={(stageItems, status) => {
              const total = stageItems.reduce((s, l) => s + l.value, 0)
              const weighted = (total * lookups.probability(status)) / 100
              return `${fmtCompactMoney(total)} · weighted ${fmtCompactMoney(weighted)}`
            }}
            renderCard={(lead) => <LeadCard lead={lead} lookups={lookups} serviceOf={catalog.byId} alerts={leadAlerts.get(lead.id)} />}
          />
        </div>
      )}

      <StageChangeModal
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={(input) => {
          const company = pending?.lead.company ?? 'Lead'
          setPending(null)
          runMove(input, company)
        }}
      />
    </div>
  )
}

/* ---------------- KPIs ---------------- */

function Kpis({ leads, loading, lookups }: { leads: LeadRow[]; loading: boolean; lookups: LookupsApi }) {
  const open = leads.filter((l) => !lookups.isClosed(l.status))
  const won = leads.filter((l) => lookups.isWon(l.status))
  const lost = leads.filter((l) => lookups.isLost(l.status))
  const parked = leads.filter((l) => lookups.isParked(l.status))
  const openValue = open.reduce((s, l) => s + l.value, 0)
  const weighted = open.reduce((s, l) => s + (l.value * lookups.probability(l.status)) / 100, 0)
  const wonValue = won.reduce((s, l) => s + l.value, 0)
  const winRate = won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0

  const cards = [
    {
      label: 'Open pipeline',
      value: fmtCompactMoney(openValue),
      hint: `${open.length} open leads${parked.length ? ` · ${parked.length} parked` : ''}`,
    },
    { label: 'Weighted forecast', value: fmtCompactMoney(weighted), hint: 'Value × stage probability' },
    { label: 'Won', value: fmtCompactMoney(wonValue), hint: `${won.length} deals, converted to customers` },
    { label: 'Win rate', value: `${winRate.toFixed(1)}%`, hint: 'Won vs. closed as lost' },
  ]
  return (
    <section aria-label="Pipeline figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) =>
        loading ? (
          <Skeleton key={c.label} className="h-[6.625rem] rounded-card" />
        ) : (
          <div key={c.label} className="rounded-card border border-line bg-surface px-5 py-4 shadow-xs">
            <p className="text-[0.875rem] text-ink-2">{c.label}</p>
            <p className="num mt-1.5 text-[1.5rem] leading-tight font-bold tracking-[-0.02em]">{c.value}</p>
            <p className="mt-1 truncate text-[0.8125rem] text-muted">{c.hint}</p>
          </div>
        ),
      )}
    </section>
  )
}

/* ---------------- Card ---------------- */

function scoreTone(score: number): string {
  if (score >= 80) return 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500'
  if (score >= 60) return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500'
  return 'bg-sunken text-muted'
}

function LeadCard({
  lead,
  lookups,
  serviceOf,
  alerts,
}: {
  lead: LeadRow
  lookups: LookupsApi
  serviceOf: (id: string | null | undefined) => Service | undefined
  alerts?: Alert[]
}) {
  const days = Math.max(0, differenceInCalendarDays(new Date(), new Date(lead.stageChangedAt)))
  const recommended = serviceOf(lead.recommendedServiceId)
  const title = recommended?.name ?? lead.company
  // One chip per category of the services of interest (plus the recommended one).
  const categories = [
    ...new Set(
      [lead.recommendedServiceId, ...lead.serviceIds]
        .map((sid) => serviceOf(sid)?.category)
        .filter((c): c is string => !!c),
    ),
  ]

  return (
    <KanbanCard>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.6875rem] text-muted">{lead.id}</span>
        <span className="flex items-center gap-1.5">
          {lead.doNotContact && <Ban className="size-3.5 text-danger-600" aria-label="Do not contact" />}
          <span className={cn('num rounded-md px-1.5 text-[0.75rem] leading-5 font-semibold', scoreTone(lead.score))} title="Interest score">
            {lead.score}
          </span>
        </span>
      </div>

      <Link
        to={leadPath(lead.id)}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 block text-[0.9375rem] leading-snug font-semibold text-ink hover:underline"
      >
        {title}
      </Link>
      <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
        <Building2 className="size-3.5 shrink-0 text-subtle" aria-hidden />
        <span className="truncate">{lead.company}</span>
      </p>
      {!recommended && lead.recommendedServiceText && (
        <p
          className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-warning-50 px-2 text-[0.6875rem] leading-5 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500"
          title={`Unmatched service: ${lead.recommendedServiceText}`}
        >
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          <span className="truncate">Unmatched: {lead.recommendedServiceText}</span>
        </p>
      )}
      <LeadAlertBadges alerts={alerts} className="mt-2" />

      <div className="mt-3 flex items-center gap-1.5">
        {categories.map((c) => {
          const meta = categoryMeta(c)
          const label = lookups.serviceCategoryLabel(c)
          return (
            <span key={c} title={label} className={cn('flex size-6 items-center justify-center rounded-md', meta.tone)}>
              <meta.icon className="size-3.5" aria-label={label} />
            </span>
          )
        })}
        {lead.sourceDetail && (
          <span className="ms-auto flex min-w-0 items-center gap-1 text-xs text-muted" title={`${lookups.sourceLabel(lead.sourceType)}: ${lead.sourceDetail}`}>
            <Megaphone className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{lead.sourceDetail}</span>
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <span className="num flex-1 text-[0.9375rem] font-bold">{lead.value ? fmtCompactMoney(lead.value) : `${getRegion().currency} —`}</span>
        <span className="num flex items-center gap-1 text-xs text-muted" title="Days in this stage">
          <Clock className="size-3.5" aria-hidden />
          {days}d
        </span>
        <span title={lead.ownerName}>
          <Avatar name={lead.ownerName} size="sm" />
        </span>
      </div>
    </KanbanCard>
  )
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pipeline" className="flex gap-2.5 overflow-hidden px-4 pt-5 sm:px-6 lg:px-10">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="w-[20rem] shrink-0 space-y-2.5 rounded-card bg-sunken/70 p-2.5">
          <Skeleton className="m-1.5 h-5 w-32" />
          <Skeleton className="h-40 rounded-xl bg-surface" />
          <Skeleton className="h-40 rounded-xl bg-surface" />
        </div>
      ))}
    </div>
  )
}
