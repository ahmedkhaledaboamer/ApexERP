import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { useEntitlements } from '@/modules/billing/hooks'
import { PageHeader, IconTile } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { Modal } from '@/shared/components/ui/Modal'
import { Tabs } from '@/shared/components/ui/Tabs'
import { TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { aiApi, useAiConversations, useAiMe, useInvalidateAi } from '../api'
import { suggestedPrompts } from '../prompts'
import { AiChat } from '../components/AiChat'
import { AiSettingsPanel } from '../components/AiSettingsPanel'
import type { AiConversation, AiUsage } from '../types'
import { useNewParam } from '@/shared/hooks/useNewParam'

type Tab = 'chat' | 'settings'

function UsageChip({ usage }: { usage: AiUsage }) {
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs shadow-xs" data-testid="ai-usage" title={usage.warning ?? undefined}>
      <span className="text-muted">AI requests this period</span>
      <span className="font-semibold tabular-nums">
        {usage.used.toLocaleString()}
        {usage.limit !== null ? ` / ${usage.limit.toLocaleString()}` : ''}
      </span>
      {pct !== null ? (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className={cn('block h-full rounded-full', pct >= 100 ? 'bg-danger-500' : pct >= 80 ? 'bg-warning-500' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
        </span>
      ) : (
        <Badge tone="green">Unlimited</Badge>
      )}
    </div>
  )
}

/** /ai — the assistant: private conversations (rename / delete), the chat, admin settings and usage. */
export default function AiAssistantPage() {
  const user = useCurrentUser()
  const ent = useEntitlements()
  const me = useAiMe()
  const list = useAiConversations()
  const invalidate = useInvalidateAi()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('chat')
  const [renaming, setRenaming] = useState<AiConversation | null>(null)
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<AiConversation | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = params.get('c')
  // Remounts the thread when the user picks another conversation or starts a new one (not when the first message creates one).
  const [fresh, setFresh] = useState(0)
  // ?new=1 (header "+ New" › New AI conversation): a fresh thread.
  useNewParam(
    () => {
      setTab('chat')
      setFresh((n) => n + 1)
    },
    { when: !!user },
  )

  if (!user) return null
  const select = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id) next.set('c', id)
        else next.delete('c')
        return next
      },
      { replace: !id },
    )

  async function doRename() {
    if (!renaming) return
    setBusy(true)
    try {
      await aiApi.rename(renaming.id, title)
      void invalidate('conversations')
      setRenaming(null)
    } catch (e) {
      toast.error('Couldn’t rename', e instanceof ApiError ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }
  async function doDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await aiApi.remove(deleting.id)
      if (selected === deleting.id) select(null)
      void invalidate('conversations')
      setDeleting(null)
      toast.success('Conversation deleted')
    } catch (e) {
      toast.error('Couldn’t delete', e instanceof ApiError ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const prompts = suggestedPrompts(user.role, (m) => ent.hasModule(m)).map((p) => ({ label: p, prompt: p }))
  const canManage = !!me.data?.canManage
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <PageHeader
        icon={
          <IconTile tone="brand">
            <Bot />
          </IconTile>
        }
        title="AI assistant"
        description="Looks up your records as your role sees them, drafts emails, suggests services and summarizes notes. Any change asks for your confirmation first."
        actions={
          <>
            {me.data?.usage && <UsageChip usage={me.data.usage} />}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setTab('chat')
                select(null)
                setFresh((n) => n + 1)
              }}
            >
              <MessageSquarePlus />
              New conversation
            </Button>
          </>
        }
      >
        {canManage && (
          <Tabs
            label="AI assistant"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'chat', label: 'Assistant' },
              { id: 'settings', label: 'Settings & usage' },
            ]}
          />
        )}
      </PageHeader>
      {me.data?.usage?.warning && (
        <p role="status" className="mx-auto mt-3 w-full max-w-[100rem] px-4 text-xs text-warning-700 sm:px-6 lg:px-10 dark:text-warning-500">
          {me.data.usage.warning}
        </p>
      )}

      {tab === 'settings' && canManage ? (
        <div className="mx-auto w-full max-w-[100rem] overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
          <AiSettingsPanel />
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-[100rem] flex-1 gap-4 px-4 py-4 sm:px-6 lg:px-10">
          <Card className="hidden w-72 shrink-0 flex-col overflow-hidden md:flex">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[0.8125rem] font-semibold">Your conversations</p>
              <p className="text-xs text-muted">Private to you.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="ai-conversations">
              {list.isPending ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : !list.data?.length ? (
                <p className="px-2 py-6 text-center text-xs text-muted">No conversations yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {list.data.map((c) => (
                    <li key={c.id} className={cn('group flex items-center rounded-md', selected === c.id ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-hover')}>
                      <button type="button" className="min-w-0 flex-1 px-2.5 py-2 text-start" onClick={() => {
                          select(c.id)
                          setFresh((n) => n + 1)
                        }} aria-current={selected === c.id || undefined}>
                        <p className="truncate text-[0.8125rem] font-medium" dir="auto">
                          {c.title}
                        </p>
                        <p className="truncate text-xs text-muted" dir="auto">
                          {c.lastMessage || 'Empty'}
                        </p>
                      </button>
                      <Menu
                        trigger={(props) => (
                          <Button variant="ghost" size="xs" iconOnly aria-label={`Options for ${c.title}`} className="me-1 opacity-60 group-hover:opacity-100" {...props}>
                            <MoreHorizontal />
                          </Button>
                        )}
                      >
                        <MenuItem
                          icon={<Pencil />}
                          onSelect={() => {
                            setRenaming(c)
                            setTitle(c.title)
                          }}
                        >
                          Rename
                        </MenuItem>
                        <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(c)}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {me.isError ? (
              <EmptyState title="The assistant isn’t available" body={me.error.message} />
            ) : (
              <AiChat
                key={fresh}
                conversationId={selected}
                onConversationChange={(id) => select(id)}
                suggestions={prompts}
                disabledReason={me.data && !me.data.enabled ? me.data.disabledReason : null}
              />
            )}
          </Card>
        </div>
      )}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename conversation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={doRename} loading={busy} disabled={!title.trim()}>
              Save
            </Button>
          </>
        }
      >
        <label htmlFor="ai-rename" className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">
          Name
        </label>
        <TextInput id="ai-rename" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus dir="auto" />
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this conversation?"
        description="Its messages and any unconfirmed proposals are removed. Changes you already confirmed stay."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete} loading={busy}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem]" dir="auto">
          {deleting?.title}
        </p>
      </Modal>
    </div>
  )
}
