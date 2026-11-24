import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Pencil, ShieldCheck, XCircle } from 'lucide-react'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { aiApi } from '../api'
import type { AiAction, AiMessage } from '../types'

const FIELD_LABEL: Record<string, string> = {
  to: 'To',
  subject: 'Subject',
  body: 'Message',
  title: 'Title',
  dueDate: 'Due date',
  priority: 'Priority',
  summary: 'Call note',
  nextStep: 'Next step',
  nextFollowUpDate: 'Next follow-up',
  lossReason: 'Loss reason',
  validUntil: 'Valid until',
}
const isDate = (k: string) => /date|validUntil/i.test(k)

const STATUS: Record<AiAction['status'], { label: string; tone: 'amber' | 'green' | 'neutral' | 'red' }> = {
  pending: { label: 'Waiting for your confirmation', tone: 'amber' },
  confirmed: { label: 'Done', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'red' },
}

/**
 * A proposed change: exactly what will change (field · before → after), then Confirm / Edit / Cancel. Nothing is
 * changed until Confirm (POST /ai/actions/:id/confirm runs the normal service with its permission checks).
 */
export function ActionCard({ action, onDone }: { action: AiAction; onDone: (action: AiAction, followUp: AiMessage) => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(action.editable.map((k) => [k, String(action.input[k] ?? '')])))
  const pending = action.status === 'pending'
  const status = STATUS[action.status]

  async function run(kind: 'confirm' | 'cancel') {
    setBusy(kind)
    setError(null)
    try {
      const r = kind === 'confirm' ? await aiApi.confirm(action.id, draft) : await aiApi.cancel(action.id)
      setEditing(false)
      onDone(r.action, r.message)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const shown = action.changes.map((c) => (editing && action.editable.includes(c.field) ? { ...c, to: draft[c.field] ?? c.to } : c))
  return (
    <div className={cn('rounded-lg border bg-surface shadow-xs', pending ? 'border-brand-200 dark:border-brand-500/30' : 'border-line')} data-testid="ai-action" data-tool={action.tool} data-status={action.status}>
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold text-ink">{action.title}</p>
          <p className="text-xs text-muted">{action.summary}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <table className="w-full text-[0.8125rem]">
        <caption className="sr-only">What will change</caption>
        <tbody className="divide-y divide-line">
          {shown.map((c) => (
            <tr key={c.field}>
              <th scope="row" className="w-36 px-3 py-1.5 text-start align-top text-xs font-medium text-muted">
                {c.label}
              </th>
              <td className="px-3 py-1.5 align-top">
                <span className="flex flex-wrap items-center gap-1.5">
                  {c.from !== '—' && <span className="text-subtle line-through">{c.from}</span>}
                  {c.from !== '—' && <ArrowRight className="size-3 text-subtle rtl:rotate-180" aria-hidden />}
                  <span className="break-words text-ink">{c.to}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {action.tool === 'draft_email' && !editing && (
        <pre className="mx-3 mb-2 max-h-56 overflow-y-auto rounded-md border border-line bg-sunken px-3 py-2 font-sans text-[0.8125rem] whitespace-pre-wrap text-ink-2" data-testid="ai-action-body" dir={action.input.language === 'ar' ? 'rtl' : undefined}>
          {String(action.input.body ?? '')}
        </pre>
      )}

      {editing && (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          {action.editable.map((k) => {
            const id = `ai-edit-${action.id}-${k}`
            const label = FIELD_LABEL[k] ?? k
            const value = draft[k] ?? ''
            const set = (v: string) => setDraft((d) => ({ ...d, [k]: v }))
            return (
              <label key={k} htmlFor={id} className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
                {action.choices[k] ? (
                  <SelectInput id={id} value={value} onChange={(e) => set(e.target.value)}>
                    {action.choices[k].map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </SelectInput>
                ) : k === 'body' || k === 'summary' ? (
                  <TextArea id={id} rows={k === 'body' ? 8 : 3} value={value} onChange={(e) => set(e.target.value)} dir="auto" />
                ) : (
                  <TextInput id={id} type={isDate(k) ? 'date' : 'text'} value={value} onChange={(e) => set(e.target.value)} dir="auto" />
                )}
              </label>
            )
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="mx-3 mb-2 text-xs text-danger-600">
          {error}
        </p>
      )}
      {action.status === 'failed' && action.error && <p className="mx-3 mb-2 text-xs text-danger-600">{action.error}</p>}
      {action.result && (
        <p className="mx-3 mb-2 flex items-center gap-1.5 text-xs text-success-700 dark:text-success-500">
          <CheckCircle2 className="size-3.5" aria-hidden />
          {action.result.link ? (
            <Link to={action.result.link} className="hover:underline">
              {action.result.label}
            </Link>
          ) : (
            action.result.label
          )}
        </p>
      )}

      {pending && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">
          <span className="me-auto text-xs text-muted">Nothing changes until you confirm.</span>
          <Button variant="ghost" size="sm" onClick={() => run('cancel')} loading={busy === 'cancel'} disabled={!!busy}>
            <XCircle />
            Cancel
          </Button>
          {action.editable.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)} disabled={!!busy}>
              <Pencil />
              {editing ? 'Done editing' : 'Edit'}
            </Button>
          )}
          <Button write size="sm" onClick={() => run('confirm')} loading={busy === 'confirm'} disabled={!!busy}>
            <CheckCircle2 />
            {action.tool === 'draft_email' ? 'Confirm & send' : 'Confirm'}
          </Button>
        </div>
      )}
    </div>
  )
}
