import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Copy, FileText, Lock, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import type { AiAction, AiBlock, AiCard, AiMessage } from '../types'
import { ActionCard } from './ActionCard'

/** Copies text; resolves false when the clipboard isn't available. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  )
}

/** Plain-text version of an answer (copy button). */
export function messageText(m: AiMessage): string {
  const parts: string[] = []
  for (const b of m.blocks) {
    if (b.type === 'text' || b.type === 'notice' || b.type === 'refusal') parts.push(b.text)
    else if (b.type === 'bullets') parts.push([b.title, ...b.items.map((i) => `• ${i}`)].filter(Boolean).join('\n'))
    else if (b.type === 'stats') parts.push(b.items.map((i) => `${i.label}: ${i.value}`).join('\n'))
    else if (b.type === 'cards') parts.push(b.cards.map((c) => `${c.title} — ${c.subtitle}${c.badge ? ` (${c.badge})` : ''}`).join('\n'))
    else if (b.type === 'table') parts.push([b.title, b.columns.map((c) => c.label).join('\t'), ...b.rows.map((r) => b.columns.map((c) => String(r[c.key] ?? '')).join('\t'))].join('\n'))
    else if (b.type === 'draft') parts.push(`Subject: ${b.subject}\n\n${b.body}`)
  }
  return parts.join('\n\n')
}

/** Reveals the text a few words at a time (a simulated token stream) when `stream` is set. */
function useStreamed(text: string, stream: boolean): { text: string; done: boolean } {
  const words = text.split(/(\s+)/)
  const [n, setN] = useState(stream ? 0 : Number.MAX_SAFE_INTEGER)
  const done = n >= words.length
  useEffect(() => {
    if (!stream || done) return
    const t = window.setTimeout(() => setN((x) => x + 4), 16)
    return () => window.clearTimeout(t)
  }, [n, stream, done])
  return { text: done ? text : words.slice(0, n).join(''), done }
}

const CARD_BADGE_TONE: Record<string, 'brand' | 'neutral' | 'amber' | 'green'> = { lead: 'brand', customer: 'green', service: 'neutral', package: 'neutral', task: 'amber' }

function RecordCard({ card }: { card: AiCard }) {
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold text-ink">{card.title}</p>
          <p className="truncate text-xs text-muted">{card.subtitle}</p>
        </div>
        {card.badge && <Badge tone={CARD_BADGE_TONE[card.type] ?? 'neutral'}>{card.badge}</Badge>}
      </div>
      {card.meta.length > 0 && (
        <dl className="mt-2 space-y-0.5">
          {card.meta.map((m) => (
            <div key={m.label} className="flex gap-2 text-xs">
              <dt className="shrink-0 text-muted">{m.label}</dt>
              <dd className="min-w-0 text-ink-2">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 font-mono text-[0.6875rem] text-subtle">{card.id}</p>
    </>
  )
  const cls = 'block rounded-lg border border-line bg-surface p-3 text-start shadow-xs transition-colors'
  return card.link ? (
    <Link to={card.link} className={cn(cls, 'hover:border-brand-300 hover:bg-hover')} data-testid="ai-card" data-record={`${card.type}:${card.id}`}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid="ai-card" data-record={`${card.type}:${card.id}`}>
      {body}
    </div>
  )
}

function Block({ block }: { block: AiBlock }) {
  switch (block.type) {
    case 'text':
      return null
    case 'cards':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {block.cards.map((c) => (
            <RecordCard key={`${c.type}:${c.id}`} card={c} />
          ))}
        </div>
      )
    case 'table':
      return (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-2">
            <p className="flex-1 text-xs font-semibold text-ink-2">{block.title}</p>
            <span className="text-xs text-muted">{block.rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[0.8125rem]" data-testid="ai-table">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  {block.columns.map((c) => (
                    <th key={c.key} className={cn('px-3 py-1.5 font-medium whitespace-nowrap', c.align === 'end' ? 'text-end' : 'text-start')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {block.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-hover">
                    {block.columns.map((c, j) => {
                      const v = String(r[c.key] ?? '')
                      const link = j === 0 ? block.links[i] : null
                      return (
                        <td key={c.key} className={cn('px-3 py-1.5 whitespace-nowrap', c.align === 'end' ? 'text-end tabular-nums' : 'text-start')}>
                          {link ? (
                            <Link to={link} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                              {v}
                            </Link>
                          ) : (
                            v
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    case 'stats':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {block.items.map((s) => (
            <div key={s.label} className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-0.5 text-[0.8125rem] font-semibold text-ink tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )
    case 'bullets':
      return (
        <div>
          {block.title && <p className="mb-1 text-xs font-semibold text-ink-2">{block.title}</p>}
          <ul className="list-disc space-y-0.5 ps-5 text-[0.8125rem] text-ink-2">
            {block.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )
    case 'draft':
      return (
        <div className="rounded-lg border border-line bg-surface" dir={block.language === 'ar' ? 'rtl' : undefined}>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <FileText className="size-4 text-muted" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{block.subject}</p>
            <CopyButton text={`Subject: ${block.subject}\n\n${block.body}`} label="Copy draft" />
          </div>
          <pre className="px-3 py-2 font-sans text-[0.8125rem] whitespace-pre-wrap text-ink-2">{block.body}</pre>
        </div>
      )
    case 'refusal':
      return (
        <div role="note" data-testid="ai-refusal" className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{block.text}</span>
        </div>
      )
    case 'notice':
      return (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-ink-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-600" aria-hidden />
          <span>{block.text}</span>
        </div>
      )
  }
}

interface MessageViewProps {
  message: AiMessage
  /** Reveal the answer as a stream (the newest answer only). */
  stream?: boolean
  onStreamed?: () => void
  onActionDone: (action: AiAction, followUp: AiMessage) => void
}

export function MessageView({ message, stream = false, onStreamed, onActionDone }: MessageViewProps) {
  const rtl = message.language === 'ar'
  const { text, done: streamed } = useStreamed(message.content, stream)
  const notify = useRef(onStreamed)
  notify.current = onStreamed
  useEffect(() => {
    if (stream && streamed) notify.current?.()
  }, [stream, streamed])
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="ai-user-message">
        <div className="max-w-[85%] rounded-2xl rounded-ee-sm bg-brand-600 px-3.5 py-2 text-[0.8125rem] whitespace-pre-wrap text-white dark:bg-brand-500" dir={rtl ? 'rtl' : undefined}>
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5" data-testid="ai-assistant-message" data-intent={message.intent ?? ''}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white [&_svg]:size-3.5" aria-hidden>
        <Sparkles />
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-[0.875rem] leading-relaxed whitespace-pre-wrap text-ink" dir={rtl ? 'rtl' : undefined} aria-live={stream ? 'polite' : undefined}>
          {text}
          {!streamed && <span className="ms-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand-500 align-middle" aria-hidden />}
        </p>
        {streamed && (
          <>
            <div className="space-y-2.5" dir={rtl ? 'rtl' : undefined}>
              {message.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
            {message.actions.map((a) => (
              <ActionCard key={a.id} action={a} onDone={onActionDone} />
            ))}
            <div className="flex items-center gap-1 text-xs text-subtle">
              <CopyButton text={messageText(message)} />
              {message.toolCalls.length > 0 && <span className="font-mono">{message.toolCalls.map((t) => t.name).join(' · ')}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
