import { useState, type FormEvent } from 'react'
import { History, MessageSquare } from 'lucide-react'
import type { CreativeComment, CreativeEvent } from '@/modules/marketing/creative/types'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { TextArea } from '@/shared/components/form/Field'

/** Comments (with @mentions) and the change history of a content item or design request. */
export function Discussion({
  comments,
  history,
  canComment,
  pending,
  onComment,
}: {
  comments: CreativeComment[]
  history: CreativeEvent[]
  canComment: boolean
  pending: boolean
  onComment: (body: string, done: () => void) => void
}) {
  const [body, setBody] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    onComment(body.trim(), () => setBody(''))
  }
  return (
    <div className="space-y-5">
      <section aria-label="Comments" className="space-y-3">
        <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <MessageSquare className="size-4 text-muted" aria-hidden />
          Comments
          <span className="num text-xs font-normal text-muted">{comments.length}</span>
        </h3>
        {comments.length === 0 && <p className="text-[0.8125rem] text-muted">No comments yet.</p>}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.authorName} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  <span className="font-medium text-ink">{c.authorName}</span> · {fmtDate(c.at, 'd MMM, HH:mm')}
                </p>
                <p className="text-[0.8125rem] whitespace-pre-wrap text-ink-2">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
        {canComment && (
          <form onSubmit={submit} className="space-y-2">
            <TextArea aria-label="New comment" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment… use @Name to mention someone" />
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!body.trim()}>
                Comment
              </Button>
            </div>
          </form>
        )}
      </section>
      <section aria-label="History" className="space-y-2">
        <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <History className="size-4 text-muted" aria-hidden />
          History
        </h3>
        <ol className="space-y-1.5 border-s border-line ps-3">
          {[...history].reverse().map((h) => (
            <li key={h.id} className="text-xs text-muted">
              <span className="text-ink-2">{h.summary}</span> · {h.userName} · {fmtDate(h.at, 'd MMM, HH:mm')}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
