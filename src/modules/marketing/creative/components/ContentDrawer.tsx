import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, CalendarCheck, CheckCircle2, ExternalLink, Pencil, Send, Undo2 } from 'lucide-react'
import { CONTENT_TYPE_LABEL, type ContentItem, type ContentStatus, type ContentStatusInput } from '@/modules/marketing/creative/types'
import { useContentComment, useContentItem, useContentStatus, useCreativeAccess } from '@/modules/marketing/creative/hooks'
import { campaignPath } from '@/modules/marketing/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Property, PropertyList } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextInput } from '@/shared/components/form/Field'
import { ChannelChips, ContentStatusBadge } from './badges'
import { LinkedAssets } from './AssetPicker'
import { Discussion } from './Discussion'
import { ContentForm } from './ContentForm'

/** A content item: details, the status actions the caller may take, comments and history. */
export function ContentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useContentItem(id)
  const item = query.data
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={item?.title ?? 'Content'}
      description={item ? <span className="flex flex-wrap items-center gap-2"><ContentStatusBadge status={item.status} />{CONTENT_TYPE_LABEL[item.type]}</span> : undefined}
      width="lg"
    >
      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : item ? (
        <ContentDetail item={item} />
      ) : null}
    </Drawer>
  )
}

function ContentDetail({ item }: { item: ContentItem }) {
  const { canEdit, user } = useCreativeAccess()
  const status = useContentStatus()
  const comment = useContentComment()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [url, setUrl] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [when, setWhen] = useState(item.publishLocal ?? '')

  function move(to: ContentStatus, extra: Partial<ContentStatusInput> = {}, done?: () => void) {
    status.mutate(
      { id: item.id, input: { status: to, ...extra } },
      {
        onSuccess: (c) => {
          toast.success(`Moved to ${c.status.replace('_', ' ')}`, c.title)
          done?.()
        },
        onError: (e) => toast.error('Couldn’t change the status', e.message),
      },
    )
  }

  const s = item.status
  return (
    <div className="space-y-6">
      {item.overdue && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
          The publish time has passed. Mark it published with the live link, or reschedule it.
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2" aria-label="Actions">
          {s !== 'published' && s !== 'archived' && (
            <Button write size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )}
          {s === 'idea' && (
            <Button write size="sm" variant="secondary" onClick={() => move('draft')}>
              Start draft
            </Button>
          )}
          {(s === 'idea' || s === 'draft') && (
            <Button write size="sm" onClick={() => move('in_review')}>
              <Send />
              Send for review
            </Button>
          )}
          {s === 'in_review' && (
            <>
              <Button write size="sm" onClick={() => move('approved')} disabled={!item.canApprove} title={item.canApprove ? undefined : 'You can’t approve your own content (only a Company Admin can).'}>
                <CheckCircle2 />
                Approve
              </Button>
              <Button write size="sm" variant="secondary" onClick={() => move('draft')}>
                Back to draft
              </Button>
            </>
          )}
          {s === 'approved' && (
            <Button write size="sm" onClick={() => setScheduling(true)}>
              <CalendarCheck />
              Schedule
            </Button>
          )}
          {s === 'scheduled' && (
            <Button write size="sm" variant="secondary" onClick={() => move('approved')}>
              <Undo2 />
              Unschedule
            </Button>
          )}
          {(s === 'approved' || s === 'scheduled') && (
            <Button write size="sm" variant="secondary" onClick={() => setPublishing(true)}>
              <ExternalLink />
              Mark published
            </Button>
          )}
          {s !== 'archived' ? (
            <Button write size="sm" variant="ghost" onClick={() => move('archived')}>
              <Archive />
              Archive
            </Button>
          ) : (
            <Button write size="sm" variant="secondary" onClick={() => move('draft')}>
              Restore as draft
            </Button>
          )}
        </div>
      )}
      {s === 'in_review' && !item.canApprove && canEdit && item.ownerId === user.id && (
        <p className="text-xs text-muted">You own this item, so another marketing manager (or a Company Admin) approves it.</p>
      )}

      {scheduling && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            move('scheduled', when ? { publishAt: when } : {}, () => setScheduling(false))
          }}
        >
          <Field id="ci-schedule" label={`Publish at (${item.timezone})`}>
            <TextInput id="ci-schedule" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Button write type="submit" size="sm" loading={status.isPending}>
            Confirm schedule
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setScheduling(false)}>
            Cancel
          </Button>
        </form>
      )}
      {publishing && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            move('published', { publishedUrl: url }, () => setPublishing(false))
          }}
        >
          <Field id="ci-url" label="Live link">
            <TextInput id="ci-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-72" />
          </Field>
          <Button write type="submit" size="sm" loading={status.isPending}>
            Confirm published
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPublishing(false)}>
            Cancel
          </Button>
        </form>
      )}

      <PropertyList>
        <Property label="Publish">{item.publishLocal ? `${fmtDate(item.publishLocal, 'EEE d MMM yyyy, HH:mm')} (${item.timezone})` : 'Not planned'}</Property>
        <Property label="Channels">
          <ChannelChips channels={item.channels} max={9} />
        </Property>
        <Property label="Owner">{item.ownerName || '—'}</Property>
        <Property label="Reviewer">{item.reviewerName || '—'}</Property>
        {item.approvedBy && <Property label="Approved by">{`${item.approvedByName} · ${fmtDate(item.approvedAt)}`}</Property>}
        <Property label="Campaign">{item.campaignId ? <Link className="text-brand-700 hover:underline dark:text-brand-300" to={campaignPath(item.campaignId)}>{item.campaignName}</Link> : '—'}</Property>
        {item.publishedUrl && (
          <Property label="Published">
            <a href={item.publishedUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand-700 hover:underline dark:text-brand-300">
              {item.publishedUrl}
            </a>
          </Property>
        )}
        <Property label="Assets">
          <LinkedAssets assets={item.assets} />
        </Property>
      </PropertyList>
      {item.body && (
        <section aria-label="Copy">
          <h3 className="mb-1 text-[0.8125rem] font-semibold">Copy</h3>
          <p className="rounded-lg bg-sunken/60 p-3 text-[0.8125rem] whitespace-pre-wrap text-ink-2">{item.body}</p>
        </section>
      )}
      {item.notes && <p className="text-[0.8125rem] text-muted">{item.notes}</p>}

      <Discussion
        comments={item.comments}
        history={item.history}
        canComment={canEdit}
        pending={comment.isPending}
        onComment={(body, done) => comment.mutate({ id: item.id, body }, { onSuccess: done, onError: (e) => toast.error('Comment not saved', e.message) })}
      />
      <ContentForm open={editing} onClose={() => setEditing(false)} item={item} currentUserId={user.id} />
    </div>
  )
}
