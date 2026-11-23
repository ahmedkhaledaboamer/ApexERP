import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Sparkles } from 'lucide-react'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { aiApi, useAiConversation, useAiKey } from '../api'
import type { AiAction, AiMessage, AiRecordRef } from '../types'
import { MessageView } from './MessageView'

interface AiChatProps {
  conversationId: string | null
  /** A conversation was created for the first message. */
  onConversationChange: (id: string) => void
  /** The record the questions are about ("Ask AI" on a lead / customer page). */
  context?: AiRecordRef | null
  suggestions: { label: string; prompt: string }[]
  /** Panel layout (Ask AI drawer). */
  compact?: boolean
  disabledReason?: string | null
}

const tempMessage = (content: string): AiMessage => ({
  id: `tmp-${Date.now()}`,
  conversationId: '',
  role: 'user',
  content,
  language: /[؀-ۿ]/.test(content) ? 'ar' : 'en',
  blocks: [],
  toolCalls: [],
  toolResults: [],
  actions: [],
  context: null,
  intent: null,
  createdAt: new Date().toISOString(),
})

/** The thread and the composer. Answers are revealed as a stream; proposals render as action cards. */
export function AiChat({ conversationId, onConversationChange, context = null, suggestions, compact = false, disabledReason = null }: AiChatProps) {
  const qc = useQueryClient()
  const key = useAiKey()
  const detail = useAiConversation(conversationId)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [streamId, setStreamId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // Load the conversation (unless a send is in flight: its answer is merged locally).
  useEffect(() => {
    if (!conversationId) {
      if (!sendingRef.current) setMessages([])
      return
    }
    if (detail.data && !sendingRef.current) setMessages(detail.data.messages)
  }, [conversationId, detail.data])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length, sending])

  async function send(content: string) {
    const body = content.trim()
    if (!body || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setError(null)
    setText('')
    const temp = tempMessage(body)
    setMessages((m) => [...m, temp])
    try {
      let id = conversationId
      if (!id) {
        id = (await aiApi.create()).id
        onConversationChange(id)
      }
      const r = await aiApi.post(id, body, context)
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), ...r.messages])
      setStreamId(r.messages[r.messages.length - 1]?.id ?? null)
      void qc.invalidateQueries({ queryKey: key('conversations') })
      void qc.invalidateQueries({ queryKey: key('me') })
      void qc.invalidateQueries({ queryKey: key('conversation', id) })
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== temp.id))
      setText(body)
      setError(e instanceof ApiError ? e.message : 'The assistant didn’t answer. Try again.')
    } finally {
      sendingRef.current = false
      setSending(false)
      input.current?.focus()
    }
  }

  function onActionDone(action: AiAction, followUp: AiMessage) {
    setMessages((m) => [...m.map((x) => (x.id === action.messageId ? { ...x, actions: x.actions.map((a) => (a.id === action.id ? action : a)) } : x)), followUp])
    setStreamId(followUp.id)
    // The confirmed change ran through the normal service: refresh the screens' data.
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'ai' })
    if (conversationId) void qc.invalidateQueries({ queryKey: key('conversation', conversationId) })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(text)
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(text)
    }
  }

  const loading = !!conversationId && detail.isPending && messages.length === 0
  const empty = !loading && messages.length === 0
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-1 py-2' : 'px-4 py-5 sm:px-6')} data-testid="ai-thread">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="ms-auto h-8 w-1/2" />
            <Skeleton className="h-24 w-3/4" />
          </div>
        )}
        {empty && (
          <div className={cn('mx-auto flex max-w-xl flex-col items-center text-center', compact ? 'py-4' : 'py-10')}>
            <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-gradient text-white [&_svg]:size-5" aria-hidden>
              <Sparkles />
            </span>
            <p className="text-sm font-semibold">{context ? 'Ask about this record' : 'How can I help today?'}</p>
            <p className="mt-1 text-[0.8125rem] text-muted">I only see what your role can see. Any change I prepare waits for your confirmation. English or Arabic.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2" data-testid="ai-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s.prompt}
                  type="button"
                  disabled={!!disabledReason || sending}
                  onClick={() => void send(s.prompt)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8125rem] text-ink-2 shadow-xs transition-colors hover:border-brand-300 hover:bg-hover disabled:opacity-50"
                  dir="auto"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={cn('mx-auto space-y-5', compact ? '' : 'max-w-3xl')}>
          {messages.map((m) => (
            <MessageView key={m.id} message={m} stream={m.id === streamId} onStreamed={() => setStreamId(null)} onActionDone={onActionDone} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted" role="status">
              <span className="flex gap-1" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-brand-500" />
              </span>
              Thinking…
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <form onSubmit={onSubmit} className={cn('border-t border-line bg-surface', compact ? 'px-1 pt-3' : 'px-4 py-3 sm:px-6')}>
        <div className={cn('mx-auto', compact ? '' : 'max-w-3xl')}>
          {(error || disabledReason) && (
            <p role="alert" className="mb-2 text-xs text-danger-600" data-testid="ai-error">
              {disabledReason ?? error}
            </p>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 shadow-xs focus-within:border-brand-500 focus-within:shadow-[var(--shadow-focus)]">
            <label htmlFor="ai-composer" className="sr-only">
              Message the assistant
            </label>
            <textarea
              id="ai-composer"
              ref={input}
              data-testid="ai-composer"
              rows={compact ? 2 : 1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              maxLength={2000}
              dir="auto"
              disabled={!!disabledReason}
              placeholder={context ? 'Ask about this record…' : 'Ask anything — e.g. “What should I follow up today?”'}
              className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-[0.875rem] text-ink placeholder:text-subtle focus:outline-none"
            />
            <Button type="submit" size="sm" iconOnly aria-label="Send" data-testid="ai-send" disabled={!text.trim() || sending || !!disabledReason}>
              <ArrowUp />
            </Button>
          </div>
          {!compact && <p className="mt-1.5 text-center text-[0.6875rem] text-subtle">Answers come from your records as your role sees them. Enter to send, Shift+Enter for a new line.</p>}
        </div>
      </form>
    </div>
  )
}
