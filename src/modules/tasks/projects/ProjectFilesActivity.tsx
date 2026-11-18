import { useMemo } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { FileArchive, FileImage, FileSpreadsheet, FileText, FolderOpen, History, Paperclip } from 'lucide-react'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { fmtBytes, useOpenTask, type ProjectDetail } from './projectUi'

function useNameOf() {
  const people = useUsersQuery()
  return useMemo(() => {
    const map = new Map((people.data ?? []).map((u) => [u.id, u.name]))
    return (id: string) => map.get(id) ?? id
  }, [people.data])
}

function FileIcon({ type }: { type: string }) {
  const cls = 'size-4 shrink-0 text-muted'
  if (type.startsWith('image/')) return <FileImage className={cls} aria-hidden />
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return <FileSpreadsheet className={cls} aria-hidden />
  if (type.includes('zip') || type.includes('compressed')) return <FileArchive className={cls} aria-hidden />
  return <FileText className={cls} aria-hidden />
}

function typeLabel(type: string, name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  return ext || type.split('/').pop()?.toUpperCase() || 'File'
}

/** Project › Files: every task attachment across the project. */
export function ProjectFiles({ project: p }: { project: ProjectDetail }) {
  const openTask = useOpenTask()
  const nameOf = useNameOf()
  const files = useMemo(
    () => p.tasks.flatMap((t) => t.attachments.map((a) => ({ ...a, taskId: t.id, taskTitle: t.title }))).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [p.tasks],
  )
  if (!files.length) {
    return (
      <Card>
        <EmptyState icon={<FolderOpen aria-hidden />} title="No files yet" body="Files attached to this project’s tasks show up here." />
      </Card>
    )
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-[0.8125rem]">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-4 py-2 text-start font-medium">File</th>
            <th className="px-3 py-2 text-start font-medium">Task</th>
            <th className="px-3 py-2 text-start font-medium">Type</th>
            <th className="px-3 py-2 text-end font-medium">Size</th>
            <th className="px-3 py-2 text-start font-medium">Uploaded by</th>
            <th className="px-4 py-2 text-start font-medium">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {files.map((f) => (
            <tr key={`${f.taskId}-${f.id}`}>
              <td className="max-w-[18rem] px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileIcon type={f.type} />
                  <span className="truncate text-ink" title={f.name}>
                    {f.name}
                  </span>
                </span>
              </td>
              <td className="max-w-[14rem] px-3 py-2.5">
                <button type="button" onClick={() => openTask(f.taskId)} className="block max-w-full truncate text-start text-ink-2 hover:text-ink hover:underline" title={f.taskTitle}>
                  {f.taskTitle}
                </button>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="outline">{typeLabel(f.type, f.name)}</Badge>
              </td>
              <td className="num px-3 py-2.5 text-end whitespace-nowrap text-ink-2">{fmtBytes(f.size)}</td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                  <Avatar name={nameOf(f.uploadedBy)} size="xs" />
                  {nameOf(f.uploadedBy)}
                </span>
              </td>
              <td className="num px-4 py-2.5 whitespace-nowrap text-muted">{fmtDate(f.uploadedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

interface Entry {
  id: string
  at: string
  userName: string
  summary: string
  /** Task the event belongs to; null for project-level (audit) events. */
  task: { id: string; title: string } | null
  kind: string
}

/** Project › Activity: task history and the project's audit trail, newest first. */
export function ProjectActivity({ project: p }: { project: ProjectDetail }) {
  const openTask = useOpenTask()
  const nameOf = useNameOf()
  const entries = useMemo<Entry[]>(() => {
    const fromTasks = p.tasks.flatMap((t) =>
      t.history.map((h) => ({ id: `${t.id}-${h.id}`, at: h.at, userName: nameOf(h.userId), summary: h.summary, task: { id: t.id, title: t.title }, kind: h.kind })),
    )
    const fromAudit = (p.audit ?? []).map((a) => ({ id: a.id, at: a.at, userName: a.userName, summary: a.summary, task: null, kind: 'project' }))
    return [...fromTasks, ...fromAudit].sort((a, b) => b.at.localeCompare(a.at))
  }, [p.tasks, p.audit, nameOf])

  if (!entries.length) {
    return (
      <Card>
        <EmptyState icon={<History aria-hidden />} title="No activity yet" body="Changes to the project and its tasks are listed here." />
      </Card>
    )
  }
  return (
    <Card>
      <ol className="divide-y divide-line">
        {entries.map((e) => (
          <li key={e.id} className="flex gap-3 px-4 py-3">
            <Avatar name={e.userName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] text-ink">
                <span className="font-medium">{e.userName}</span> <span className="text-ink-2">{e.summary}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <time dateTime={e.at} title={fmtDate(e.at, 'd MMM yyyy, HH:mm')}>
                  {formatDistanceToNow(parseISO(e.at), { addSuffix: true })}
                </time>
                {e.task ? (
                  <button type="button" onClick={() => openTask(e.task!.id)} className="inline-flex max-w-full items-center gap-1 truncate hover:text-ink hover:underline">
                    {e.kind === 'attachment' && <Paperclip className="size-3" aria-hidden />}
                    {e.task.title}
                  </button>
                ) : (
                  <Badge tone="brand">Project</Badge>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
