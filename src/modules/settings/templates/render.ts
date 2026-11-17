import { isKnownVariable, VARIABLES } from './variables'

/**
 * Pure template rendering. No React, no I/O: safe to use from the editor preview, the
 * quotations module, the AI agent or a server port.
 */

type Value = string | number | null | undefined

/** `{ lead: { company: 'Acme' }, agent: { name: 'Sara' } }` fills `{{lead.company}}`, `{{agent.name}}`. */
export type TemplateContext = Partial<Record<string, Partial<Record<string, Value>>>>

/** One piece of a rendered template, for previews that style variables. */
export type RenderSegment =
  | { kind: 'text'; text: string }
  /** A known variable with a value. */
  | { kind: 'value'; key: string; text: string }
  /** A known variable with no value for this record (e.g. no follow-up date set). */
  | { kind: 'empty'; key: string; text: '' }
  /** Not in the catalog (typo or unsupported). */
  | { kind: 'unknown'; key: string; text: string }

/** Matches `{{ anything }}` without nested braces; the inner text is trimmed when read. */
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g

/** How unknown variables appear in plain-text output, so nobody sends them unnoticed. */
export function unknownMarker(key: string): string {
  return `[unknown: ${key || 'empty variable'}]`
}

function lookup(ctx: TemplateContext, key: string): string {
  const [group, field] = key.split('.')
  const v = ctx[group]?.[field]
  return v === null || v === undefined ? '' : String(v)
}

/** Splits text into literal text and variables, filled from `ctx`. */
export function renderSegments(text: string, ctx: TemplateContext): RenderSegment[] {
  const out: RenderSegment[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    const key = m[1]
    if (!isKnownVariable(key)) out.push({ kind: 'unknown', key, text: m[0] })
    else {
      const value = lookup(ctx, key)
      out.push(value ? { kind: 'value', key, text: value } : { kind: 'empty', key, text: '' })
    }
    last = start + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/**
 * Replaces every `{{group.field}}` with its value. Known variables without a value become empty
 * (or `missing(key)` if given); unknown ones are left visibly marked as `[unknown: key]`.
 */
export function renderTemplate(text: string, ctx: TemplateContext, opts: { missing?: (key: string) => string } = {}): string {
  return renderSegments(text, ctx)
    .map((s) => (s.kind === 'unknown' ? unknownMarker(s.key) : s.kind === 'empty' ? (opts.missing?.(s.key) ?? '') : s.text))
    .join('')
}

/** Every variable key used, unique, in order of first use (includes unknown ones). */
export function findVariables(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(TOKEN)) seen.add(m[1])
  return [...seen]
}

/** Variable keys not in the catalog. Empty array means the template is valid. */
export function unknownVariables(text: string): string[] {
  return findVariables(text).filter((k) => !isKnownVariable(k))
}

/** A context filled with every variable's sample value, for previews without real data. */
export function sampleContext(): TemplateContext {
  const ctx: Record<string, Record<string, string>> = {}
  for (const v of VARIABLES) (ctx[v.group] ??= {})[v.field] = v.sample
  return ctx
}
