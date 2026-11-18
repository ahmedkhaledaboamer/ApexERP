import { useRef } from 'react'
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import type { User } from '@/shared/types'
import type { TaskAttachment } from '@/modules/tasks/types'
import { useAddTaskAttachment, useRemoveTaskAttachment } from '@/modules/tasks/hooks/useTasks'
import { taskAttachmentSchema } from '@/modules/tasks/schemas'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { fmtBytes } from './taskMeta'

function FileIcon({ type, name }: { type: string; name: string }) {
  const cls = 'size-4 shrink-0'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (type.startsWith('image/')) return <FileImage className={`${cls} text-pink-600 dark:text-pink-300`} aria-hidden />
  if (type.includes('sheet') || type.includes('excel') || ['csv', 'xlsx', 'xls'].includes(ext)) {
    return <FileSpreadsheet className={`${cls} text-success-600 dark:text-success-500`} aria-hidden />
  }
  if (type.includes('zip') || type.includes('compressed') || ['zip', 'rar', '7z'].includes(ext)) {
    return <FileArchive className={`${cls} text-warning-600 dark:text-warning-500`} aria-hidden />
  }
  if (type === 'application/pdf' || type.startsWith('text/') || type.includes('word') || ['pdf', 'doc', 'docx', 'txt'].includes(ext)) {
    return <FileText className={`${cls} text-danger-600 dark:text-danger-500`} aria-hidden />
  }
  return <File className={`${cls} text-muted`} aria-hidden />
}

/** Mocked upload: only the file's name, size and type are sent and stored. */
export function TaskAttachments({
  taskId,
  attachments,
  allUsers,
  canEdit,
}: {
  taskId: string
  attachments: TaskAttachment[]
  allUsers: User[]
  canEdit: boolean
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const add = useAddTaskAttachment(taskId)
  const remove = useRemoveTaskAttachment(taskId)
  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? 'Unknown'

  async function onFiles(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      const meta = { name: f.name, size: f.size, type: f.type || 'application/octet-stream' }
      const parsed = taskAttachmentSchema.safeParse(meta)
      if (!parsed.success) {
        toast.error(`Couldn’t attach ${f.name}`, parsed.error.issues[0]?.message)
        continue
      }
      try {
        await add.mutateAsync(parsed.data)
      } catch (e) {
        toast.error(`Couldn’t attach ${f.name}`, (e as Error).message)
      }
    }
    if (input.current) input.current.value = ''
  }

  return (
    <div className="space-y-3">
      {attachments.length === 0 ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
          <Paperclip className="size-4 text-subtle" aria-hidden />
          No files attached.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
              <FileIcon type={a.type} name={a.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] text-ink" title={a.name}>
                  {a.name}
                </p>
                <p className="truncate text-xs text-muted">
                  <span className="num">{fmtBytes(a.size)}</span> · {a.type || 'file'} · {nameOf(a.uploadedBy)}, {fmtDate(a.uploadedAt, 'd MMM')}
                </p>
              </div>
              {canEdit && (
                <Button write
                  variant="ghost"
                  size="xs"
                  iconOnly
                  aria-label={`Remove ${a.name}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(a.id, {
                      onSuccess: () => toast.success('Attachment removed', a.name),
                      onError: (e) => toast.error('Couldn’t remove it', e.message),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <input ref={input} type="file" multiple className="sr-only" id={`${taskId}-file`} onChange={(e) => void onFiles(e.target.files)} />
          <Button write variant="secondary" size="sm" loading={add.isPending} onClick={() => input.current?.click()}>
            <Upload />
            Attach files
          </Button>
          <span className="text-xs text-subtle">Up to 25 MB each</span>
        </div>
      )}
    </div>
  )
}
