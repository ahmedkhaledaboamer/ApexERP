import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { AtSign, MessageSquare, Send } from 'lucide-react'
import type { User } from '@/shared/types'
import type { TaskComment } from '@/modules/tasks/types'
import { useAddTaskComment } from '@/modules/tasks/hooks/useTasks'
import { taskCommentSchema, TASK_COMMENT_MAX } from '@/modules/tasks/schemas'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { TextArea } from '@/shared/components/form/Field'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Comment body with @mentions highlighted. */
function CommentBody({ body, mentionNames }: { body: string; mentionNames: string[] }) {
  if (!mentionNames.length) return <>{body}</>
  const re = new RegExp(`(@(?:${mentionNames.map(escape).join('|')}))`, 'gi')
  const parts = body.split(re)
  return (
    <>
      {parts.map((p, i): ReactNode =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function TaskComments({
  taskId,
  comments,
  users,
  allUsers,
}: {
  taskId: string
  comments: TaskComment[]
  /** Active users for the @mention list. */
  users: User[]
  allUsers: User[]
}) {
  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? 'Unknown'
  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
          <MessageSquare className="size-4 text-subtle" aria-hidden />
          No comments yet. Type @ to mention someone.
        </p>
      ) : (
        <ol className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={nameOf(c.authorId)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-medium text-ink">{nameOf(c.authorId)}</span>{' '}
                  <time dateTime={c.at} title={fmtDate(c.at, 'd MMM yyyy, HH:mm')} className="text-subtle">
                    {formatDistanceToNowStrict(new Date(c.at), { addSuffix: true })}
                  </time>
                </p>
                <p className="mt-0.5 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
                  <CommentBody body={c.body} mentionNames={c.mentions.map(nameOf)} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <CommentComposer taskId={taskId} users={users} />
    </div>
  )
}

/** Composer with @mention autocomplete: typing "@" opens the people list; ↑/↓ and Enter pick. */
function CommentComposer({ taskId, users }: { taskId: string; users: User[] }) {
  const id = useId()
  const toast = useToast()
  const add = useAddTaskComment(taskId)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [error, setError] = useState<string>()
  /** Active "@query" before the caret: start index + text. */
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    return users.filter((u) => u.name.toLowerCase().split(' ').some((p) => p.startsWith(q)) || u.name.toLowerCase().startsWith(q)).slice(0, 6)
  }, [trigger, users])

  function detect(value: string, caret: number) {
    const before = value.slice(0, caret)
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before)
    if (m) {
      setTrigger({ start: caret - m[2].length - 1, query: m[2] })
      setActive(0)
    } else setTrigger(null)
  }

  function pick(u: User) {
    if (!trigger) return
    const el = ref.current
    const caret = el?.selectionStart ?? body.length
    const next = `${body.slice(0, trigger.start)}@${u.name} ${body.slice(caret)}`
    setBody(next)
    setMentions((m) => (m.includes(u.id) ? m : [...m, u.id]))
    setTrigger(null)
    const pos = trigger.start + u.name.length + 2
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  async function submit() {
    const parsed = taskCommentSchema.safeParse({ body })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    // Keep only mentions whose name is still in the text; the server also parses @Names.
    const kept = mentions.filter((uid) => {
      const u = users.find((x) => x.id === uid)
      return u && body.includes(`@${u.name}`)
    })
    try {
      await add.mutateAsync({ body: parsed.data.body, mentions: kept })
      setBody('')
      setMentions([])
      setError(undefined)
    } catch (e) {
      toast.error('Couldn’t post the comment', (e as Error).message)
    }
  }

  const listId = `${id}-mentions`
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Add a comment
      </label>
      <TextArea
        ref={ref}
        id={id}
        value={body}
        invalid={!!error}
        maxLength={TASK_COMMENT_MAX}
        placeholder="Add a comment… (@ to mention, Ctrl+Enter to send)"
        className="min-h-20 pe-12"
        role="combobox"
        aria-expanded={!!trigger && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setBody(e.target.value)
          setError(undefined)
          detect(e.target.value, e.target.selectionStart)
        }}
        onClick={(e) => detect(body, e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (trigger && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + matches.length) % matches.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pick(matches[active])
              return
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setTrigger(null)
              return
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {trigger && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute start-0 bottom-full z-50 mb-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-pop"
        >
          {matches.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(u)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem]', i === active && 'bg-hover')}
            >
              <Avatar name={u.name} size="xs" />
              <span className="flex-1 truncate">{u.name}</span>
              <span className="truncate text-xs text-subtle">{u.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {error ? (
          <p className="text-xs text-danger-600 dark:text-danger-500">{error}</p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-subtle">
            <AtSign className="size-3" aria-hidden />
            Mentioned people get a notification.
          </p>
        )}
        <Button write size="sm" className="ms-auto" onClick={() => void submit()} loading={add.isPending} disabled={!body.trim()}>
          <Send />
          Comment
        </Button>
      </div>
    </div>
  )
}
