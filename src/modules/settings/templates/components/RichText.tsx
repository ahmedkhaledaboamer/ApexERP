import { Fragment, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { renderSegments, type RenderSegment, type TemplateContext } from '../render'
import { getVariable } from '../variables'

interface RichTextProps {
  text: string
  ctx: TemplateContext
  /** Tint filled-in values so the reader sees what came from the record. */
  highlight?: boolean
  /** Apply WhatsApp formatting: *bold*, _italic_, ~strikethrough~. */
  whatsapp?: boolean
}

/**
 * A template rendered for preview. Values are plain text (optionally tinted), variables with no
 * value show a dashed "not set" chip, unknown variables show red. Colours use alpha tints so the
 * same markup works on themed cards, the white quotation paper and the WhatsApp bubble.
 */
export function RichText({ text, ctx, highlight = false, whatsapp = false }: RichTextProps) {
  if (!whatsapp) return <>{renderNodes(renderSegments(text, ctx), highlight)}</>
  return (
    <>
      {whatsappRuns(text).map((run, i) => {
        const nodes = renderNodes(renderSegments(run.text, ctx), highlight)
        if (run.style === 'bold') return <strong key={i} className="font-semibold">{nodes}</strong>
        if (run.style === 'italic') return <em key={i}>{nodes}</em>
        if (run.style === 'strike') return <s key={i}>{nodes}</s>
        return <Fragment key={i}>{nodes}</Fragment>
      })}
    </>
  )
}

function renderNodes(segments: RenderSegment[], highlight: boolean): ReactNode[] {
  return segments.map((s, i) => {
    if (s.kind === 'text') return <Fragment key={i}>{s.text}</Fragment>
    if (s.kind === 'unknown') {
      return (
        <span
          key={i}
          title="Unknown variable: it won’t be filled in"
          className="rounded-sm bg-danger-500/15 px-0.5 font-mono text-[0.85em] text-danger-600 underline decoration-danger-500 decoration-wavy"
        >
          {s.text}
        </span>
      )
    }
    if (s.kind === 'empty') {
      const label = getVariable(s.key)?.label ?? s.key
      return (
        <span
          key={i}
          title={`{{${s.key}}} has no value for this record; it will be left blank`}
          className="rounded-sm border border-dashed border-warning-500/70 bg-warning-500/10 px-1 text-[0.85em] text-warning-700"
        >
          {label} not set
        </span>
      )
    }
    const isLink = /^https?:\/\//.test(s.text)
    return (
      <span
        key={i}
        title={`{{${s.key}}}`}
        className={cn(
          highlight && 'rounded-sm bg-brand-500/15 box-decoration-clone',
          isLink && 'text-accent-600 underline underline-offset-2 break-all',
        )}
      >
        {s.text}
      </span>
    )
  })
}

type Run = { style: 'plain' | 'bold' | 'italic' | 'strike'; text: string }

/** One level of WhatsApp formatting; markers must open and close on the same line. */
const WA = /\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g

export function whatsappRuns(text: string): Run[] {
  const runs: Run[] = []
  let last = 0
  for (const m of text.matchAll(WA)) {
    const start = m.index ?? 0
    if (start > last) runs.push({ style: 'plain', text: text.slice(last, start) })
    if (m[1] !== undefined) runs.push({ style: 'bold', text: m[1] })
    else if (m[2] !== undefined) runs.push({ style: 'italic', text: m[2] })
    else runs.push({ style: 'strike', text: m[3] })
    last = start + m[0].length
  }
  if (last < text.length) runs.push({ style: 'plain', text: text.slice(last) })
  return runs
}
