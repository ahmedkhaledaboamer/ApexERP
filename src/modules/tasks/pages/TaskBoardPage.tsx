import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { subDays } from 'date-fns'
import { CalendarClock, ListChecks, Lock, MessageSquare, MoreHorizontal, OctagonAlert, Paperclip, SquareKanban, Unlock, X } from 'lucide-react'
import type { TaskPriority, TaskStatus, TaskView } from '@/modules/tasks/types'
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { useProjectsQuery, useTasksQuery } from '@/modules/tasks/hooks/useTasks'
import { cn } from '@/shared/lib/utils'
import { KanbanBoard, KanbanCard, type KanbanColumn } from '@/shared/components/kanban'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SelectInput } from '@/shared/components/form/Field'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { BlockedBadge, PriorityBadge } from '@/modules/tasks/components/TaskBadges'
import { LinkChip } from '@/modules/tasks/components/LinkChip'
import { TaskPageFrame } from '@/modules/tasks/components/TaskPageFrame'
import { dueLabel, STATUS_TONE } from '@/modules/tasks/components/taskMeta'
import { useActiveUsers, useOpenTask, useTaskBlocking, useTaskPermissions, useTaskStatusChange } from '@/modules/tasks/components/useTaskActions'

/** Done and cancelled tasks stay on the board for this many days. */
const DONE_DAYS = 14

/**
 * Board columns: the working statuses plus Done. Cancelled is a column only when "Show cancelled"
 * is on (a filter, so the board stays usable); Blocked is a flag shown as a badge on the card.
 */
const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']
const boardColumn = (s: TaskStatus): KanbanColumn<TaskStatus> => ({ id: s, label: TASK_STATUS_LABEL[s], tone: STATUS_TONE[s] })

/** Kanban by status: drag a card to change it. Block… / Unblock is on each card's menu. */
export default function TaskBoardPage() {
  const [params, setParams] = useSearchParams()
  const ownerId = params.get('owner') ?? ''
  const projectId = params.get('project') ?? ''
  const priority = (params.get('priority') ?? '') as TaskPriority | ''
  const showCancelled = params.get('cancelled') === '1'
  const blockedOnly = params.get('blocked') === '1'
  const columns = useMemo(() => [...BOARD_STATUSES, ...(showCancelled ? (['cancelled'] as TaskStatus[]) : [])].map(boardColumn), [showCancelled])

  const { scope, blockReason, editBlock } = useTaskPermissions()
  const toast = useToast()
  const query = useTasksQuery({ includeDone: true })
  const projects = useProjectsQuery()
  const { all: allUsers } = useActiveUsers()
  const openTask = useOpenTask()

  // Optimistic: the move updates the cached lists at once and rolls back if the server refuses.
  const status = useTaskStatusChange()
  const blocking = useTaskBlocking()

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const items = useMemo(() => {
    const cutoff = subDays(new Date(), DONE_DAYS).toISOString()
    return (query.data ?? [])
      .filter(
        (t) =>
          (t.status !== 'cancelled' || (showCancelled && t.updatedAt >= cutoff)) &&
          (t.status !== 'done' || !t.completedAt || t.completedAt >= cutoff) &&
          (!blockedOnly || t.blocked) &&
          (!ownerId || t.ownerId === ownerId) &&
          (!projectId || t.projectId === projectId) &&
          (!priority || t.priority === priority),
      )
  }, [query.data, ownerId, projectId, priority, showCancelled, blockedOnly])

  const owners = useMemo(() => {
    const ids = new Set((query.data ?? []).map((t) => t.ownerId))
    return [...ids].map((id) => ({ id, name: allUsers.find((u) => u.id === id)?.name ?? (query.data ?? []).find((t) => t.ownerId === id)?.ownerName ?? id })).sort((a, b) => a.name.localeCompare(b.name))
  }, [query.data, allUsers])

  const anyFilter = !!(ownerId || projectId || priority || blockedOnly)

  return (
    <TaskPageFrame
      title="Task board"
      icon={<SquareKanban />}
      description={query.data ? <span className="num">{`${items.length} tasks`}</span> : 'Loading…'}
    >
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          {scope !== 'own' && (
            <SelectInput aria-label="Owner" value={ownerId} onChange={(e) => setParam('owner', e.target.value)} className="h-8 w-44 text-xs">
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectInput>
          )}
          <SelectInput
            aria-label="Project"
            value={projectId}
            disabled={projects.isPending || projects.isError}
            onChange={(e) => setParam('project', e.target.value)}
            className="h-8 w-48 text-xs"
          >
            <option value="">
              {projects.isPending ? 'Loading projects…' : projects.isError ? 'Projects unavailable' : projects.data.length ? 'All projects' : 'No projects'}
            </option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput aria-label="Priority" value={priority} onChange={(e) => setParam('priority', e.target.value)} className="h-8 w-36 text-xs">
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectInput>
          <label className="inline-flex h-8 items-center gap-1.5 text-xs text-ink-2">
            <Checkbox id="board-blocked-only" checked={blockedOnly} onChange={(e) => setParam('blocked', e.target.checked ? '1' : '')} />
            Blocked only
          </label>
          <label className="inline-flex h-8 items-center gap-1.5 text-xs text-ink-2">
            <Checkbox id="board-show-cancelled" checked={showCancelled} onChange={(e) => setParam('cancelled', e.target.checked ? '1' : '')} />
            Show cancelled
          </label>
          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev)
                    for (const k of ['owner', 'project', 'priority', 'blocked']) next.delete(k)
                    return next
                  },
                  { replace: true },
                )
              }
            >
              Reset
              <X />
            </Button>
          )}
          <p id="board-hint" data-can-move={blockReason === null} className="ms-auto text-xs text-muted">
            {blockReason === null ? (
              `Done shows the last ${DONE_DAYS} days. Drag cards to change status, or focus a card and use Space + arrow keys. Block… is on each card’s menu.`
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden /> View only: {blockReason}
              </span>
            )}
          </p>
        </div>

        {query.isPending ? (
          <div aria-busy="true" className="flex gap-2.5 overflow-hidden">
            {BOARD_STATUSES.map((s) => (
              <Skeleton key={s} className="h-[28rem] w-[20rem] shrink-0 rounded-card" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState title="No tasks yet" body="Tasks you own, follow or can see in your scope show up here." />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <KanbanBoard<TaskView, TaskStatus>
              columns={columns}
              items={items}
              getId={(t) => t.id}
              getColumn={(t) => t.status}
              canMove={blockReason === null}
              canMoveItem={(t) => t.canEdit}
              onMove={(t, to) => status.change(t, to)}
              onBlockedMove={(t) => toast.error(`“${t.title}” wasn’t moved`, editBlock(t) ?? undefined)}
              emptyLabel={anyFilter ? 'Nothing matches' : blockReason === null ? 'Drop a task here' : 'No tasks'}
              renderCard={(t, { overlay }) => (
                <BoardCard
                  task={t}
                  onOpen={openTask}
                  dragging={overlay}
                  canChange={blockReason === null && t.canEdit}
                  onBlock={() => blocking.block(t)}
                  onUnblock={() => blocking.unblock(t)}
                />
              )}
            />
          </div>
        )}
      </PageBody>
      {blocking.dialog}
    </TaskPageFrame>
  )
}

interface BoardCardProps {
  task: TaskView
  onOpen: (id: string) => void
  dragging: boolean
  canChange: boolean
  onBlock: () => void
  onUnblock: () => void
}

function BoardCard({ task, onOpen, dragging, canChange, onBlock, onUnblock }: BoardCardProps) {
  const closed = task.status === 'done' || task.status === 'cancelled'
  return (
    <div onClick={() => onOpen(task.id)}>
      <KanbanCard className={cn('space-y-2.5 p-3', dragging && 'shadow-pop')}>
        {!task.canEdit && <span className="sr-only">View only. </span>}
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(task.id)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              'block min-w-0 flex-1 rounded text-start text-[0.8125rem] leading-snug font-medium focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
              closed ? 'text-muted line-through' : 'text-ink hover:underline',
            )}
          >
            {task.title}
          </button>
          {canChange && !closed && !dragging && (
            <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Menu
                className="w-44"
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    aria-label={`Actions for ${task.title}`}
                    className="-me-1 -mt-0.5 inline-flex size-6 items-center justify-center rounded text-subtle hover:bg-hover hover:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                )}
              >
                {(close) =>
                  task.blocked ? (
                    <MenuItem
                      icon={<Unlock />}
                      onSelect={() => {
                        close()
                        onUnblock()
                      }}
                    >
                      Unblock
                    </MenuItem>
                  ) : (
                    <MenuItem
                      icon={<OctagonAlert />}
                      onSelect={() => {
                        close()
                        onBlock()
                      }}
                    >
                      Block…
                    </MenuItem>
                  )
                }
              </Menu>
            </div>
          )}
        </div>
        {(task.blocked || task.linkView || task.subtaskProgress.total > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {task.blocked && <BlockedBadge reason={task.blockedReason} />}
            {task.linkView && <LinkChip link={task.linkView} maxWidthClass="max-w-full" />}
            {task.subtaskProgress.total > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted"
                aria-label={`${task.subtaskProgress.done} of ${task.subtaskProgress.total} sub-tasks done`}
              >
                <ListChecks className="size-3.5" aria-hidden />
                <span className="num">
                  {task.subtaskProgress.done}/{task.subtaskProgress.total}
                </span>
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs whitespace-nowrap',
              task.overdue ? 'font-medium text-danger-600 dark:text-danger-500' : 'text-muted',
            )}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            <span className="num">{dueLabel(task.dueDate)}</span>
            {task.overdue && <span className="sr-only">(overdue)</span>}
          </span>
          <span className="ms-auto flex items-center gap-2 text-xs text-subtle">
            {task.comments.length > 0 && (
              <span className="inline-flex items-center gap-0.5" aria-label={`${task.comments.length} comments`}>
                <MessageSquare className="size-3.5" aria-hidden />
                <span className="num">{task.comments.length}</span>
              </span>
            )}
            {task.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5" aria-label={`${task.attachments.length} attachments`}>
                <Paperclip className="size-3.5" aria-hidden />
                <span className="num">{task.attachments.length}</span>
              </span>
            )}
            <Tooltip label={task.ownerName}>
              <Avatar name={task.ownerName} size="xs" />
            </Tooltip>
          </span>
        </div>
      </KanbanCard>
    </div>
  )
}
