import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Paperclip, Pencil, Save, Trash2 } from 'lucide-react'
import { DESIGN_STATUS_LABEL, DESIGN_TYPE_LABEL, type DesignRequest, type DesignStatus } from '@/modules/marketing/creative/types'
import { attachmentProblem, acceptFor } from '@/modules/marketing/creative/assetRules'
import { readPickedFile } from '@/modules/marketing/creative/upload'
import {
  useCreativeAccess,
  useDesignAttachment,
  useDesignComment,
  useDesignRequest,
  useDesignStatus,
  useRemoveDesignAttachment,
  useSaveToAssets,
} from '@/modules/marketing/creative/hooks'
import { brandAssetPath } from '@/modules/marketing/paths'
import { formatBytes } from '@/modules/settings/branding'
import { fmtDate } from '@/shared/lib/utils'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Property, PropertyList } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { DesignStatusBadge, PriorityBadge } from './badges'
import { AssetThumb, LinkedAssets } from './AssetPicker'
import { Discussion } from './Discussion'
import { DesignRequestForm } from './NewDesignRequest'

/** Button label for a move. */
const MOVE_LABEL: Record<DesignStatus, string> = {
  requested: 'Reopen',
  in_progress: 'Start work',
  in_review: 'Send for review',
  changes_requested: 'Request changes',
  approved: 'Approve',
  delivered: 'Mark delivered',
  cancelled: 'Cancel request',
}

export function DesignDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useDesignRequest(id)
  const r = query.data
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={r?.title ?? 'Design request'}
      description={
        r ? (
          <span className="flex flex-wrap items-center gap-2">
            <DesignStatusBadge status={r.status} />
            <PriorityBadge priority={r.priority} />
            {DESIGN_TYPE_LABEL[r.type]}
          </span>
        ) : undefined
      }
    >
      {query.isPending ? <Skeleton className="h-48" /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => query.refetch()} /> : r ? <DesignDetail r={r} /> : null}
    </Drawer>
  )
}

function DesignDetail({ r }: { r: DesignRequest }) {
  const { user } = useCreativeAccess()
  const navigate = useNavigate()
  const status = useDesignStatus()
  const comment = useDesignComment()
  const attach = useDesignAttachment()
  const remove = useRemoveDesignAttachment()
  const save = useSaveToAssets()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [fileError, setFileError] = useState('')
  const canUpload = r.canComment && r.status !== 'cancelled'

  function move(to: DesignStatus) {
    status.mutate({ id: r.id, status: to }, { onSuccess: () => toast.success(`Moved to ${DESIGN_STATUS_LABEL[to]}`, r.title), onError: (e) => toast.error('Couldn’t change the status', e.message) })
  }

  async function onFile(file: File | undefined) {
    setFileError('')
    if (!file) return
    const picked = await readPickedFile(file)
    const problem = attachmentProblem(picked)
    if (problem) return setFileError(problem)
    attach.mutate({ id: r.id, file: picked }, { onSuccess: () => toast.success('File attached', picked.name), onError: (e) => setFileError(e.message) })
  }

  return (
    <div className="space-y-6">
      {r.overdue && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
          Past its due date.
        </p>
      )}
      <div className="flex flex-wrap gap-2" aria-label="Actions">
        {r.canEdit && (
          <Button write size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
        )}
        {r.nextStatuses.map((s) => (
          <Button key={s} write size="sm" variant={s === 'cancelled' ? 'ghost' : s === 'changes_requested' || s === 'requested' ? 'secondary' : 'primary'} onClick={() => move(s)} loading={status.isPending && status.variables?.status === s}>
            {MOVE_LABEL[s]}
          </Button>
        ))}
        {r.status === 'delivered' && r.canManage && (
          <Button
            write
            size="sm"
            variant="secondary"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { id: r.id },
                {
                  onSuccess: (a) => {
                    toast.success('Saved to Brand assets', a.name)
                    navigate(brandAssetPath(a.id))
                  },
                  onError: (e) => toast.error('Not saved', e.message),
                },
              )
            }
          >
            <Save />
            Save to Brand assets
          </Button>
        )}
      </div>

      <PropertyList>
        <Property label="Requested by">{`${r.requesterName} · ${fmtDate(r.createdAt)}`}</Property>
        <Property label="Designer">{r.assigneeName || 'Not assigned'}</Property>
        <Property label="Due">{r.dueDate ? fmtDate(r.dueDate) : '—'}</Property>
        <Property label="Formats">{r.formats.length ? r.formats.join(' · ') : '—'}</Property>
        {r.campaignName && <Property label="Campaign">{r.campaignName}</Property>}
        {r.contentItemTitle && <Property label="Content">{r.contentItemTitle}</Property>}
        {r.assets.length > 0 && (
          <Property label="References">
            <LinkedAssets assets={r.assets} />
          </Property>
        )}
        {r.savedAssetIds.length > 0 && <Property label="In Brand assets">{`${r.savedAssetIds.length} file${r.savedAssetIds.length === 1 ? '' : 's'}`}</Property>}
      </PropertyList>
      <section aria-label="Brief">
        <h3 className="mb-1 text-[0.8125rem] font-semibold">Brief</h3>
        <p className="rounded-lg bg-sunken/60 p-3 text-[0.8125rem] whitespace-pre-wrap text-ink-2">{r.brief}</p>
      </section>

      <section aria-label="Files" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            <Paperclip className="size-4 text-muted" aria-hidden />
            Files
          </h3>
          {canUpload && (
            <>
              <input ref={fileRef} type="file" className="hidden" accept={acceptFor('any')} aria-label="Attach a file" data-testid="design-file-input" onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
              <Button write size="sm" variant="secondary" loading={attach.isPending} onClick={() => fileRef.current?.click()}>
                Attach file
              </Button>
            </>
          )}
        </div>
        {fileError && (
          <p role="alert" className="text-[0.8125rem] text-danger-600">
            {fileError}
          </p>
        )}
        {r.attachments.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">No files yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {r.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <AssetThumb asset={{ url: a.url, name: a.name, kind: a.mimeType.startsWith('image/') ? 'image' : 'document' }} className="size-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] text-ink">{a.name}</p>
                  <p className="text-xs text-muted">
                    {formatBytes(a.sizeBytes)} · {a.uploadedByName} · {fmtDate(a.uploadedAt)}
                  </p>
                </div>
                {a.url && (
                  <a href={a.url} download={a.name} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label={`Download ${a.name}`}>
                    <Download className="size-4" />
                  </a>
                )}
                {(r.canManage || a.uploadedBy === user.id) && r.status !== 'delivered' && (
                  <Button size="xs" variant="ghost" iconOnly aria-label={`Remove ${a.name}`} onClick={() => remove.mutate({ id: r.id, attachmentId: a.id }, { onError: (e) => toast.error('Not removed', e.message) })}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Discussion
        comments={r.comments}
        history={r.history}
        canComment={r.canComment}
        pending={comment.isPending}
        onComment={(body, done) => comment.mutate({ id: r.id, body }, { onSuccess: done, onError: (e) => toast.error('Comment not saved', e.message) })}
      />
      <DesignRequestForm open={editing} onClose={() => setEditing(false)} request={r} />
    </div>
  )
}
