import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, RotateCw, Trash2, Wand2 } from 'lucide-react'
import type { LeadField, MappingPreview, WebsiteForm, WebsiteIntegration } from '@/modules/integrations/types'
import { LEAD_FIELDS, LEAD_FIELD_LABEL } from '@/modules/integrations/types'
import { integrationsApi, useIntegrationMutation, useWebsite } from '@/modules/integrations/api'
import { CopyField, embedSnippets, usePublicUrls } from '@/modules/marketing/growth/components/bits'
import { MARKETING_PATHS, publicFormPath } from '@/modules/marketing/paths'
import { useLookups } from '@/shared/hooks/useLookups'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { Facts, Section, when } from './shared'

/** Absolute URL of an API path (the mock answers on the app's origin; VITE_API_URL may be absolute). */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
  return /^https?:/.test(base) ? `${base}${path}` : `${window.location.origin}${base}${path}`
}

/** Website & forms: Lead Generation forms with embed snippets, and the inbound webhook for third-party forms. */
export function WebsitePanel({ canEdit }: { canEdit: boolean }) {
  const q = useWebsite()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-5">
      <Forms site={q.data} />
      <Webhook site={q.data} canEdit={canEdit} />
    </div>
  )
}

function Forms({ site }: { site: WebsiteIntegration }) {
  const [open, setOpen] = useState<WebsiteForm | null>(null)
  return (
    <Section
      title="Lead forms"
      hint="Forms built in Marketing › Lead Generation. Copy a snippet to put one on your website."
      action={
        site.marketingInPlan && (
          <Link to={MARKETING_PATHS.leadGeneration} className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-700 hover:underline dark:text-brand-300">
            Manage forms
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        )
      }
    >
      {!site.marketingInPlan ? (
        <p className="text-[0.8125rem] text-muted">Lead forms are part of the Marketing module, which isn’t in your plan. Use the webhook below for forms built elsewhere.</p>
      ) : site.forms.length === 0 ? (
        <p className="text-[0.8125rem] text-muted">No lead forms yet. Create one in Lead Generation.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {site.forms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-medium text-ink">{f.name}</p>
                <p className="text-xs text-muted">
                  {f.submissions} submission{f.submissions === 1 ? '' : 's'} · {f.status}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setOpen(f)} aria-label={`Embed ${f.name}`}>
                Embed
              </Button>
            </li>
          ))}
        </ul>
      )}
      <EmbedModal form={open} onClose={() => setOpen(null)} />
    </Section>
  )
}

function EmbedModal({ form, onClose }: { form: WebsiteForm | null; onClose: () => void }) {
  const urls = usePublicUrls()
  const s = form ? embedSnippets(form, urls.url(publicFormPath(form.publicKey))) : null
  return (
    <Modal open={form !== null} onClose={onClose} title={form ? `Embed “${form.name}”` : 'Embed'} description="Paste one of these into your website’s HTML.">
      {s && (
        <div className="space-y-4">
          <CopyField label="Hosted page" value={s.hosted} testId="embed-hosted" />
          <CopyField label="Embed (iframe)" value={s.iframe} code testId="embed-iframe" />
          <CopyField label="Embed (JavaScript, auto height)" value={s.script} code testId="embed-script" />
        </div>
      )}
    </Modal>
  )
}

function Webhook({ site, canEdit }: { site: WebsiteIntegration; canEdit: boolean }) {
  const toast = useToast()
  const lookups = useLookups()
  const w = site.webhook
  const rotate = useIntegrationMutation(integrationsApi.rotateToken)
  const save = useIntegrationMutation(integrationsApi.updateInboundWebhook)
  const preview = useIntegrationMutation(integrationsApi.previewMapping)
  const [confirm, setConfirm] = useState(false)
  const [rows, setRows] = useState<[string, LeadField][]>(() => Object.entries(w.fieldMap))
  const [source, setSource] = useState(w.defaultSource)
  const [sample, setSample] = useState('{\n  "name": "Hala Nasser",\n  "email": "hala@example.com",\n  "company": "Nasser Trading",\n  "phone": "0501234567",\n  "message": "Please call me"\n}')
  const [result, setResult] = useState<MappingPreview | null>(null)
  useEffect(() => setRows(Object.entries(w.fieldMap)), [w.fieldMap])
  const url = apiUrl(w.url)
  const curl = useMemo(() => `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Hala Nasser","email":"hala@example.com","company":"Nasser Trading"}'`, [url])

  return (
    <Section title="Webhook for other form tools" hint="WordPress, Webflow, Typeform, Zapier…: post the form fields as JSON to this URL. Each submission creates (or updates) a lead.">
      <Facts
        rows={[
          ['Received', `${w.received} submission${w.received === 1 ? '' : 's'} · ${w.leadsCreated} lead${w.leadsCreated === 1 ? '' : 's'} created`],
          ['Last received', when(w.lastReceivedAt)],
          ['Token', w.rotatedAt ? `${w.tokenHint} · regenerated ${when(w.rotatedAt)} by ${w.rotatedBy}` : w.tokenHint],
        ]}
      />
      {w.paused && <Badge tone="amber">Paused: submissions answer 409</Badge>}
      <CopyField label={w.revealed ? 'Endpoint URL (keep it private)' : 'Endpoint URL (masked: only Company Admins see the full token)'} value={url} testId="webhook-url" />
      {w.revealed && <CopyField label="Example request" value={curl} code />}
      {canEdit && (
        <Button write size="sm" variant="secondary" onClick={() => setConfirm(true)}>
          <RotateCw />
          Regenerate token
        </Button>
      )}

      <div className="space-y-2">
        <p className="text-[0.8125rem] font-medium text-ink-2">Field mapping</p>
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput aria-label="Form field" disabled={!canEdit} value={k} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} className="font-mono" />
            <ArrowRight className="size-4 shrink-0 text-muted rtl:rotate-180" aria-hidden />
            <SelectInput aria-label="Lead field" disabled={!canEdit} value={v} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [x[0], e.target.value as LeadField] : x)))}>
              {LEAD_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {LEAD_FIELD_LABEL[f]}
                </option>
              ))}
            </SelectInput>
            {canEdit && (
              <Button variant="ghost" size="sm" iconOnly aria-label="Remove field" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, ['', 'note']])}>
              <Plus />
              Add field
            </Button>
            <Field id="wh-source" label="Lead source" className="ms-auto w-48">
              <SelectInput id="wh-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {lookups.sources.filter((s) => s.active).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Button
              write
              size="sm"
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { fieldMap: Object.fromEntries(rows.filter(([k]) => k.trim())), defaultSource: source },
                  { onSuccess: () => toast.success('Mapping saved'), onError: (e) => toast.error('Couldn’t save', e.message) },
                )
              }
            >
              Save mapping
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Field id="wh-sample" label="Try a sample submission (nothing is saved)">
          <TextArea id="wh-sample" rows={5} className="font-mono text-xs" value={sample} onChange={(e) => setSample(e.target.value)} />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          loading={preview.isPending}
          onClick={() => {
            let payload: Record<string, unknown>
            try {
              payload = JSON.parse(sample) as Record<string, unknown>
            } catch {
              toast.error('Not valid JSON')
              return
            }
            preview.mutate(payload, { onSuccess: setResult, onError: (e) => toast.error('Preview failed', e.message) })
          }}
        >
          <Wand2 />
          Preview mapping
        </Button>
        {result && (
          <div className="rounded-lg border border-line p-3 text-xs" data-testid="mapping-preview">
            <Facts rows={Object.entries(result.lead).map(([k, v]) => [LEAD_FIELD_LABEL[k as LeadField] ?? k, <span className="whitespace-pre-wrap">{v}</span>])} />
            {result.problems.length > 0 && <p className="mt-2 text-danger-600">{result.problems.join(' ')}</p>}
            {result.unmapped.length > 0 && <p className="mt-2 text-muted">Not mapped (kept in the note): {result.unmapped.join(', ')}</p>}
          </div>
        )}
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Regenerate the webhook token?"
        description="The current URL stops working immediately. Update every form tool that posts to it."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              write
              variant="danger"
              loading={rotate.isPending}
              onClick={() =>
                rotate.mutate(undefined, {
                  onSuccess: () => toast.success('New token created', 'Copy the new URL into your form tools.'),
                  onError: (e) => toast.error('Couldn’t regenerate', e.message),
                  onSettled: () => setConfirm(false),
                })
              }
            >
              Regenerate
            </Button>
          </>
        }
      >
        <span />
      </Modal>
    </Section>
  )
}
