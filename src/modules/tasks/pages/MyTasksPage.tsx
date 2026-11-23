import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListChecks, PartyPopper, X } from 'lucide-react'
import type { TaskLinkType, TaskPriority, TaskView } from '@/modules/tasks/types'
import { TASK_LINK_TYPES, TASK_PRIORITIES, TASK_PRIORITY_LABEL } from '@/modules/tasks/types'
import { useProjectsQuery, useTasksQuery } from '@/modules/tasks/hooks/useTasks'
import { Can } from '@/shared/components/permissions'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Switch, SelectInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { QuickAddTask } from '@/modules/tasks/components/QuickAddTask'
import { useNewParam } from '@/shared/hooks/useNewParam'
import { TaskGroups } from '@/modules/tasks/components/TaskGroups'
import { TaskPageFrame } from '@/modules/tasks/components/TaskPageFrame'
import { LINK_LABEL } from '@/modules/tasks/components/taskMeta'
import { useOpenTask, useTaskPermissions, useTaskStatusChange } from '@/modules/tasks/components/useTaskActions'

type LinkFilter = TaskLinkType | 'none' | ''

/** My tasks: what I own or follow, grouped by when it's due. */
export default function MyTasksPage() {
  const [params, setParams] = useSearchParams()
  const priority = (params.get('priority') ?? '') as TaskPriority | ''
  const projectId = params.get('project') ?? ''
  const linkType = (params.get('link') ?? '') as LinkFilter
  const showDone = params.get('done') === '1'

  const { canEdit, canCreate } = useTaskPermissions()
  // `?new=1` (header "+ New" › New task): focus the quick-add form.
  const [focusKey, setFocusKey] = useState(0)
  useNewParam(() => setFocusKey((k) => k + 1), { when: canCreate })
  const query = useTasksQuery({ mine: true, includeDone: showDone })
  const projects = useProjectsQuery()
  const openTask = useOpenTask()
  const status = useTaskStatusChange()

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

  const filtered = useMemo(() => {
    const list = query.data ?? []
    return list.filter(
      (t: TaskView) =>
        (!priority || t.priority === priority) &&
        (!projectId || t.projectId === projectId) &&
        (!linkType || (linkType === 'none' ? !t.link : t.link?.type === linkType)),
    )
  }, [query.data, priority, projectId, linkType])

  const open = (query.data ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const overdue = open.filter((t) => t.overdue).length
  const anyFilter = !!(priority || projectId || linkType)

  return (
    <TaskPageFrame
      title="My tasks"
      icon={<ListChecks />}
      description={query.data ? <span className="num">{`${open.length} open · ${overdue} overdue`}</span> : 'Loading…'}
    >
      <PageBody className="max-w-5xl space-y-4">
        <Can module="tasks" action="create">
          <QuickAddTask focusKey={focusKey} />
        </Can>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <SelectInput aria-label="Priority" value={priority} onChange={(e) => setParam('priority', e.target.value)} className="h-8 w-36 text-xs">
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectInput>
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
          <SelectInput aria-label="Linked record" value={linkType} onChange={(e) => setParam('link', e.target.value)} className="h-8 w-40 text-xs">
            <option value="">Any linked record</option>
            {TASK_LINK_TYPES.map((t) => (
              <option key={t} value={t}>
                {LINK_LABEL[t]}s
              </option>
            ))}
            <option value="none">Not linked</option>
          </SelectInput>
          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev)
                    for (const k of ['priority', 'project', 'link']) next.delete(k)
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
          <label className="ms-auto flex items-center gap-2 text-[0.8125rem] text-muted">
            <Switch checked={showDone} onChange={(v) => setParam('done', v ? '1' : '')} label="Show completed" />
            Show completed
          </label>
        </div>

        <Card className="p-2 sm:p-3">
          {query.isPending ? (
            <div aria-busy="true" className="space-y-2 p-1">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          ) : filtered.length === 0 ? (
            anyFilter ? (
              <EmptyState title="No tasks match" body="Try another priority, project or link type." />
            ) : (
              <EmptyState
                icon={<PartyPopper />}
                title="You’re all caught up"
                body="Nothing assigned to you or followed by you is open. Add a task above to plan your day."
              />
            )
          ) : (
            <TaskGroups tasks={filtered} onOpen={openTask} onStatus={status.change} canEdit={canEdit} />
          )}
        </Card>
      </PageBody>
      {status.dialog}
    </TaskPageFrame>
  )
}
