import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { User } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Button } from '@/shared/components/ui/Button'
import { useTemplatesQuery } from '@/modules/settings/hooks/useTemplates'
import { TemplateEditor } from '@/modules/settings/templates/components/TemplateEditor'
import { TemplateList } from '@/modules/settings/templates/components/TemplateList'
import { PURPOSES_BY_CHANNEL, TEMPLATE_CHANNELS, type MessageTemplate, type TemplateChannel } from '@/modules/settings/templates/types'

/**
 * Settings > Templates: follow-up emails, quotation text and WhatsApp messages with variables
 * and a live preview. System Admin edits; Management views. Every edit is audited server-side.
 * URL state: `?channel=email&t=TPL-1` (or `t=new`), so a template can be linked to.
 */
export default function TemplatesPage() {
  const user = useCurrentUser()
  if (!user) return null
  if (!can(user.role, 'settings', 'view')) {
    return (
      <Card>
        <EmptyState title="Templates aren’t part of your role" body={`${user.role} has no access to Settings.`} />
      </Card>
    )
  }
  return <Templates user={user} readOnly={!can(user.role, 'settings', 'edit')} />
}

function Templates({ user, readOnly }: { user: User; readOnly: boolean }) {
  const [params, setParams] = useSearchParams()
  const query = useTemplatesQuery()
  const [search, setSearch] = useState('')
  const [previewLeadId, setPreviewLeadId] = useState('')
  const dirtyRef = useRef(false)

  const rawChannel = params.get('channel') as TemplateChannel | null
  const channel: TemplateChannel = rawChannel && TEMPLATE_CHANNELS.includes(rawChannel) ? rawChannel : 'email'
  const paramId = params.get('t')
  const creating = paramId === 'new' && !readOnly
  const rows = useMemo(() => query.data ?? [], [query.data])

  // Desktop shows the first template of the channel when nothing is picked; small screens show the list.
  const firstInChannel = useMemo(() => {
    const order = PURPOSES_BY_CHANNEL[channel]
    return (
      rows
        .filter((t) => t.channel === channel)
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            order.indexOf(a.purpose) - order.indexOf(b.purpose) ||
            Number(b.isDefault) - Number(a.isDefault) ||
            a.name.localeCompare(b.name),
        )[0] ?? null
    )
  }, [rows, channel])
  const selected: MessageTemplate | null = creating
    ? null
    : paramId
      ? (rows.find((t) => t.id === paramId) ?? null)
      : firstInChannel
  const notFound = !!paramId && !creating && !query.isPending && !selected
  const detailOpen = !!paramId

  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])

  /** Runs `fn` unless there are unsaved changes the user wants to keep. */
  function guard(fn: () => void) {
    if (dirtyRef.current && !window.confirm('You have unsaved changes to this template. Discard them?')) return
    dirtyRef.current = false
    fn()
  }

  const go = (next: { channel: TemplateChannel; t?: string }) =>
    setParams(next.t ? { channel: next.channel, t: next.t } : { channel: next.channel }, { replace: false })

  const listProps = {
    rows,
    isLoading: query.isPending,
    error: query.isError ? query.error.message : null,
    onRetry: () => void query.refetch(),
    channel,
    onChannelChange: (c: TemplateChannel) => guard(() => go({ channel: c })),
    search,
    onSearchChange: setSearch,
    selectedId: creating ? null : (selected?.id ?? null),
    onSelect: (t: MessageTemplate) => {
      if (t.id === selected?.id && detailOpen) return
      guard(() => go({ channel: t.channel, t: t.id }))
    },
    onNew: readOnly ? null : () => guard(() => go({ channel, t: 'new' })),
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div className={cn('xl:sticky xl:top-4', detailOpen && 'hidden xl:block')}>
        <TemplateList {...listProps} />
      </div>

      <div className={cn('min-w-0', !detailOpen && 'hidden xl:block')}>
        {query.isPending ? (
          <EditorSkeleton />
        ) : notFound ? (
          <Card>
            <EmptyState
              icon={<FileText aria-hidden />}
              title="Template not found"
              body="It may have been removed from your view, or the link is wrong."
              action={
                <Button variant="secondary" size="sm" onClick={() => go({ channel })}>
                  Back to templates
                </Button>
              }
            />
          </Card>
        ) : creating || selected ? (
          <TemplateEditor
            key={creating ? `new-${channel}` : selected!.id}
            template={selected}
            newChannel={channel}
            user={user}
            readOnly={readOnly}
            previewLeadId={previewLeadId}
            onPreviewLeadChange={setPreviewLeadId}
            onDirtyChange={onDirtyChange}
            onOpen={(t) => {
              dirtyRef.current = false
              setSearch('')
              go({ channel: t.channel, t: t.id })
            }}
            onClose={() => guard(() => go({ channel }))}
          />
        ) : query.isError ? null : (
          <Card>
            <EmptyState
              icon={<FileText aria-hidden />}
              title="Pick a template"
              body={readOnly ? 'Choose a template on the left to see it.' : 'Choose a template on the left, or create a new one.'}
            />
          </Card>
        )}
      </div>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="grid items-start gap-4 2xl:grid-cols-2" aria-busy>
      <Card className="space-y-5 p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </Card>
      <Card className="space-y-4 p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </Card>
    </div>
  )
}
