import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { KanbanSquare, List, Palette, Plus, X } from 'lucide-react'
import {
  DESIGN_PRIORITIES,
  DESIGN_PRIORITY_LABEL,
  DESIGN_STATUSES,
  DESIGN_STATUS_LABEL,
  DESIGN_TYPES,
  DESIGN_TYPE_LABEL,
  type DesignRequest,
  type DesignStatus,
} from '@/modules/marketing/creative/types'
import { useCreativeAccess, useDesignRequests, useDesignStatus } from '@/modules/marketing/creative/hooks'
import { DESIGN_STATUS_TONE, DesignStatusBadge, PriorityBadge } from '@/modules/marketing/creative/components/badges'
import { DesignDrawer } from '@/modules/marketing/creative/components/DesignDrawer'
import { DesignRequestForm } from '@/modules/marketing/creative/components/NewDesignRequest'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { KanbanBoard, KanbanCard } from '@/shared/components/kanban'

type View = 'board' | 'list'
const BOARD: DesignStatus[] = ['requested', 'in_progress', 'in_review', 'changes_requested', 'approved', 'delivered']

/**
 * Design requests: open to every user of a company with the marketing module (route is plan-gated
 * only). Marketing roles see every request; everyone else sees what they asked for and what is
 * assigned to them (the API decides: services/designRequests.ts).
 */
export default function DesignRequestsPage() {
  const { canView: marketing, canEdit } = useCreativeAccess()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'list' ? 'list' : 'board'
  const openId = params.get('request')
  const [mine, setMine] = useState(false)
  const query = useDesignRequests(mine ? { mine: '1' } : {})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string[]>([])
  const [priority, setPriority] = useState<string[]>([])
  const [type, setType] = useState<string[]>([])
  const [assignee, setAssignee] = useState<string[]>([])

  const setParam = useCallback(
    (u: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(u)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const creating = params.get('new') === '1'

  const all = useMemo(() => query.data ?? [], [query.data])
  const items = useMemo(
    () =>
      all.filter((r) => {
        if (status.length && !status.includes(r.status)) return false
        if (priority.length && !priority.includes(r.priority)) return false
        if (type.length && !type.includes(r.type)) return false
        if (assignee.length && !assignee.includes(r.assigneeId ?? '')) return false
        const q = search.trim().toLowerCase()
        return !q || [r.title, r.brief, r.requesterName, r.assigneeName].join(' ').toLowerCase().includes(q)
      }),
    [all, status, priority, type, assignee, search],
  )
  const filtered = !!search || status.length + priority.length + type.length + assignee.length > 0
  const assignees = [...new Map(all.filter((r) => r.assigneeId).map((r) => [r.assigneeId!, r.assigneeName])).entries()]

  return (
    <>
      <PageHeader
        title="Design requests"
        description={marketing ? 'Briefs for the design team: assign, review, deliver and keep the results in Brand assets.' : 'What you asked the design team for, and what is assigned to you.'}
        actions={
          <Button write onClick={() => setParam({ new: '1' })}>
            <Plus />
            New request
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<View>
            label="Design request views"
            variant="pill"
            value={view}
            onChange={(v) => setParam({ view: v === 'board' ? null : v })}
            items={[
              { id: 'board', label: 'Board', icon: <KanbanSquare /> },
              { id: 'list', label: 'List', icon: <List /> },
            ]}
          />
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
          <SearchInput aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests…" className="w-full sm:w-56" />
          <FacetFilter title="Status" options={DESIGN_STATUSES.map((s) => ({ value: s, label: DESIGN_STATUS_LABEL[s] }))} selected={status} onChange={setStatus} />
          <FacetFilter title="Priority" options={DESIGN_PRIORITIES.map((p) => ({ value: p, label: DESIGN_PRIORITY_LABEL[p] }))} selected={priority} onChange={setPriority} />
          <FacetFilter title="Type" options={DESIGN_TYPES.map((t) => ({ value: t, label: DESIGN_TYPE_LABEL[t] }))} selected={type} onChange={setType} />
          {marketing && <FacetFilter title="Designer" options={assignees.map(([value, label]) => ({ value, label }))} selected={assignee} onChange={setAssignee} />}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setStatus([])
                setPriority([])
                setType([])
                setAssignee([])
              }}
            >
              Reset
              <X />
            </Button>
          )}
          {marketing && (
            <label className="ms-auto flex items-center gap-2 text-[0.8125rem] text-muted">
              <Switch checked={mine} onChange={setMine} label="Only mine" />
              Only mine
            </label>
          )}
        </div>
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Palette aria-hidden />}
            title="No design requests yet"
            body={marketing ? 'Requests from anyone in the company land here.' : 'Ask the design team for a visual, banner, brochure or deck.'}
            action={
              <Button write size="sm" onClick={() => setParam({ new: '1' })}>
                <Plus />
                New request
              </Button>
            }
          />
        ) : view === 'board' ? (
          <Board items={items} canManage={canEdit} onOpen={(id) => setParam({ request: id })} />
        ) : (
          <ListView items={items} onOpen={(id) => setParam({ request: id })} />
        )}
      </PageBody>
      <DesignDrawer id={openId} onClose={() => setParam({ request: null })} />
      <DesignRequestForm open={creating} onClose={() => setParam({ new: null })} request={null} onSaved={(r) => setParam({ new: null, request: r.id })} />
    </>
  )
}

function Board({ items, canManage, onOpen }: { items: DesignRequest[]; canManage: boolean; onOpen: (id: string) => void }) {
  const move = useDesignStatus()
  const toast = useToast()
  const explain = (r: DesignRequest, to: DesignStatus) =>
    toast.error(
      `“${r.title}” can’t move to ${DESIGN_STATUS_LABEL[to]}`,
      r.nextStatuses.length === 0
        ? 'You can only view this request.'
        : `From ${DESIGN_STATUS_LABEL[r.status]} you can move it to: ${r.nextStatuses.map((s) => DESIGN_STATUS_LABEL[s]).join(', ')}.`,
    )
  return (
    <div className="overflow-x-auto pb-2">
      <KanbanBoard<DesignRequest, DesignStatus>
        columns={BOARD.map((s) => ({ id: s, label: DESIGN_STATUS_LABEL[s], tone: DESIGN_STATUS_TONE[s] }))}
        items={items.filter((r) => r.status !== 'cancelled')}
        getId={(r) => r.id}
        getColumn={(r) => r.status}
        canMoveItem={(r) => r.nextStatuses.length > 0}
        onBlockedMove={explain}
        onMove={(r, to) => {
          if (!r.nextStatuses.includes(to)) return explain(r, to)
          move.mutate({ id: r.id, status: to }, { onError: (e) => toast.error(`“${r.title}” wasn’t moved`, e.message) })
        }}
        emptyLabel={canManage ? 'Nothing here' : 'None of yours'}
        renderCard={(r) => (
          <button type="button" onClick={() => onOpen(r.id)} className="block w-full text-start">
            <KanbanCard className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[0.8125rem] font-medium text-ink">{r.title}</p>
                <PriorityBadge priority={r.priority} />
              </div>
              <p className="text-xs text-muted">
                {DESIGN_TYPE_LABEL[r.type]} · by {r.requesterName}
              </p>
              <p className="flex items-center justify-between gap-2 text-xs">
                <span className={cn('num', r.overdue ? 'font-medium text-danger-600' : 'text-muted')}>{r.dueDate ? `Due ${fmtDate(r.dueDate, 'd MMM')}` : 'No due date'}</span>
                {r.assigneeName ? <Avatar name={r.assigneeName} size="xs" /> : <span className="text-subtle">Unassigned</span>}
              </p>
            </KanbanCard>
          </button>
        )}
      />
    </div>
  )
}

const col = createColumnHelper<DesignRequest>()

function ListView({ items, onOpen }: { items: DesignRequest[]; onOpen: (id: string) => void }) {
  const columns = useMemo(
    () => [
      col.accessor('title', {
        header: 'Request',
        enableHiding: false,
        meta: { width: 300 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.title}</p>
            <p className="truncate text-xs text-muted">{DESIGN_TYPE_LABEL[row.original.type]}</p>
          </div>
        ),
      }),
      col.accessor('status', { header: 'Status', cell: ({ getValue }) => <DesignStatusBadge status={getValue()} /> }),
      col.accessor('priority', { header: 'Priority', cell: ({ getValue }) => <PriorityBadge priority={getValue()} /> }),
      col.accessor((r) => r.dueDate ?? '', {
        id: 'due',
        header: 'Due',
        cell: ({ row }) => <span className={cn('num whitespace-nowrap', row.original.overdue ? 'font-medium text-danger-600' : 'text-ink-2')}>{row.original.dueDate ? fmtDate(row.original.dueDate) : '—'}</span>,
      }),
      col.accessor('requesterName', { header: 'Requester', cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue()}</span> }),
      col.accessor('assigneeName', { header: 'Designer', cell: ({ getValue }) => <span className="whitespace-nowrap text-ink-2">{getValue() || '—'}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-design-requests', data: items, columns, defaultSorting: [{ id: 'due', desc: false }], getRowId: (r) => r.id })
  return <DataTable table={table} onRowClick={(row) => onOpen(row.id)} empty={<EmptyState title="No requests match" body="Try another search or clear the filters." />} />
}
