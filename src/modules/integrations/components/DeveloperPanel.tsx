import { useState } from 'react'
import { KeyRound, Plus, RotateCw, Send, Trash2, Webhook } from 'lucide-react'
import type { ApiScope, ApiScopeModule, CreatedApiKey, WebhookEndpoint, WebhookEvent } from '@/modules/integrations/types'
import { API_SCOPE_MODULES, WEBHOOK_EVENTS } from '@/modules/integrations/types'
import { integrationsApi, useApiKeys, useDeliveries, useIntegrationMutation, useWebhooks } from '@/modules/integrations/api'
import { CopyField } from '@/modules/marketing/growth/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { randomSecret, Section, when } from './shared'
import { apiUrl } from './WebsitePanel'

/* ======================================================================================
 * API keys
 * ==================================================================================== */

export function ApiKeysPanel({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const q = useApiKeys()
  const create = useIntegrationMutation(integrationsApi.createApiKey)
  const revoke = useIntegrationMutation(integrationsApi.revokeApiKey)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Record<ApiScopeModule, ApiScope>>({ leads: 'read', customers: 'none', tasks: 'none', invoices: 'none', employees: 'none' })
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-5">
      <Section
        title="API keys"
        hint={`For your own systems: send the key in an X-Api-Key header, e.g. GET ${apiUrl('/public/v1/leads')}. A key is shown once.`}
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus />
              Create key
            </Button>
          )
        }
      >
        <ul className="divide-y divide-line rounded-lg border border-line">
          {q.data.map((k) => (
            <li key={k.id} className="space-y-1 px-3 py-2.5" data-testid={`api-key-${k.name}`}>
              <div className="flex flex-wrap items-center gap-2">
                <KeyRound className="size-4 text-muted" aria-hidden />
                <span className="text-[0.8125rem] font-medium">{k.name}</span>
                <code className="font-mono text-xs text-muted">{k.masked}</code>
                <Badge tone={k.status === 'active' ? 'green' : 'neutral'}>{k.status === 'active' ? 'Active' : 'Revoked'}</Badge>
                {canEdit && k.status === 'active' && (
                  <Button write size="xs" variant="ghost" className="ms-auto" loading={revoke.isPending && revoke.variables === k.id} onClick={() => revoke.mutate(k.id, { onSuccess: () => toast.success('Key revoked', 'Requests with it now answer 401.'), onError: (e) => toast.error('Couldn’t revoke', e.message) })}>
                    Revoke
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                {Object.entries(k.scopes).filter(([, s]) => s !== 'none').map(([m, s]) => `${m}:${s}`).join(' · ') || 'No scopes'} · created {when(k.createdAt)} by {k.createdBy} · last used {when(k.lastUsedAt)}
                {k.revokedAt ? ` · revoked ${when(k.revokedAt)}` : ''}
              </p>
            </li>
          ))}
          {q.data.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No API keys yet.</li>}
        </ul>
      </Section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create API key"
        description="Give the key only the access it needs. Write includes read."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              write
              loading={create.isPending}
              onClick={() =>
                create.mutate(
                  { name, scopes },
                  {
                    onSuccess: (r) => {
                      setOpen(false)
                      setName('')
                      setCreated(r)
                    },
                    onError: (e) => toast.error('Couldn’t create the key', e.message),
                  },
                )
              }
            >
              Create key
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="key-name" label="Name" hint="The system that will use it.">
            <TextInput id="key-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {API_SCOPE_MODULES.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3">
              <label htmlFor={`scope-${m.key}`} className="text-[0.8125rem]">
                {m.label}
              </label>
              <SelectInput id={`scope-${m.key}`} className="w-32" value={scopes[m.key]} onChange={(e) => setScopes((x) => ({ ...x, [m.key]: e.target.value as ApiScope }))}>
                <option value="none">No access</option>
                <option value="read">Read</option>
                <option value="write">Read & write</option>
              </SelectInput>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Copy your API key now"
        description="This is the only time the full key is shown. Store it in your system’s secret manager."
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        {created && <CopyField label={created.key.name} value={created.secret} code testId="new-api-key" />}
      </Modal>
    </div>
  )
}

/* ======================================================================================
 * Outgoing webhooks
 * ==================================================================================== */

const DELIVERY_TONE: Record<string, Tone> = { success: 'green', retrying: 'amber', failed: 'red' }

export function WebhooksPanel({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const q = useWebhooks()
  const create = useIntegrationMutation(integrationsApi.createWebhook)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ url: '', events: ['lead.created'] as WebhookEvent[], secret: '' })
  const [selected, setSelected] = useState<string | null>(null)
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-5">
      <Section
        title="Endpoints"
        hint="We POST a signed JSON event to your URL. Verify the X-Apex-Signature header (t=…,v1=HMAC-SHA256 of “t.body” with your signing secret). Failed deliveries retry 3 times."
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus />
              Add endpoint
            </Button>
          )
        }
      >
        <ul className="divide-y divide-line rounded-lg border border-line">
          {q.data.map((w) => (
            <Endpoint key={w.id} w={w} canEdit={canEdit} selected={selected === w.id} onSelect={() => setSelected(selected === w.id ? null : w.id)} />
          ))}
          {q.data.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No endpoints yet.</li>}
        </ul>
      </Section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add webhook endpoint"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              write
              loading={create.isPending}
              onClick={() =>
                create.mutate(f, {
                  onSuccess: () => {
                    setOpen(false)
                    setF({ url: '', events: ['lead.created'], secret: '' })
                    toast.success('Endpoint added', 'Events from now on are delivered to it.')
                  },
                  onError: (e) => toast.error('Couldn’t add it', e.message),
                })
              }
            >
              Add endpoint
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="wh-url" label="URL (https)">
            <TextInput id="wh-url" value={f.url} placeholder="https://example.com/hooks/apex" onChange={(e) => setF((x) => ({ ...x, url: e.target.value }))} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[0.8125rem] font-medium text-ink-2">Events</legend>
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2 text-[0.8125rem]">
                <Checkbox checked={f.events.includes(ev.key)} onChange={(e) => setF((x) => ({ ...x, events: e.target.checked ? [...x.events, ev.key] : x.events.filter((y) => y !== ev.key) }))} />
                <span className="font-mono text-xs">{ev.key}</span>
                <span className="text-muted">{ev.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="wh-secret" label="Signing secret" hint="Write-only: keep a copy, it’s never shown again.">
            <div className="flex gap-2">
              <TextInput id="wh-secret" value={f.secret} onChange={(e) => setF((x) => ({ ...x, secret: e.target.value }))} className="font-mono" />
              <Button size="sm" variant="secondary" onClick={() => setF((x) => ({ ...x, secret: randomSecret() }))}>
                Generate
              </Button>
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Endpoint({ w, canEdit, selected, onSelect }: { w: WebhookEndpoint; canEdit: boolean; selected: boolean; onSelect: () => void }) {
  const toast = useToast()
  const test = useIntegrationMutation(integrationsApi.testWebhook)
  const remove = useIntegrationMutation(integrationsApi.deleteWebhook)
  const toggle = useIntegrationMutation((active: boolean) => integrationsApi.updateWebhook(w.id, { active }))
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Webhook className="size-4 text-muted" aria-hidden />
        <button type="button" onClick={onSelect} className="min-w-0 truncate text-start font-mono text-xs text-ink hover:underline" aria-expanded={selected}>
          {w.url}
        </button>
        {!w.active && <Badge tone="neutral">Off</Badge>}
        {w.failing > 0 && <Badge tone="red">{w.failing} failed</Badge>}
        {canEdit && (
          <span className="ms-auto flex gap-1">
            <Button write size="xs" variant="ghost" loading={test.isPending} onClick={() => test.mutate(w.id, { onSuccess: (d) => (d.status === 'success' ? toast.success('Test event delivered') : toast.error('Test event failed', d.error ?? '')), onError: (e) => toast.error('Couldn’t send', e.message) })}>
              <Send />
              Test
            </Button>
            <Button write size="xs" variant="ghost" onClick={() => toggle.mutate(!w.active)}>
              {w.active ? 'Turn off' : 'Turn on'}
            </Button>
            <Button write size="xs" variant="ghost" iconOnly aria-label="Delete endpoint" onClick={() => remove.mutate(w.id, { onError: (e) => toast.error('Couldn’t delete', e.message) })}>
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        {w.events.join(', ')} · secret {w.secretHint} · last delivery {when(w.lastDeliveryAt)}
      </p>
      {selected && <Deliveries id={w.id} canEdit={canEdit} />}
    </li>
  )
}

function Deliveries({ id, canEdit }: { id: string; canEdit: boolean }) {
  const toast = useToast()
  const q = useDeliveries(id)
  const retry = useIntegrationMutation(integrationsApi.retryDelivery)
  if (q.isPending) return <Skeleton className="h-16" />
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-xs">
        <thead className="bg-sunken text-muted">
          <tr>
            <th className="px-2 py-1.5 text-start font-medium">Time</th>
            <th className="px-2 py-1.5 text-start font-medium">Event</th>
            <th className="px-2 py-1.5 text-start font-medium">Status</th>
            <th className="px-2 py-1.5 text-start font-medium">Attempts</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(q.data ?? []).map((d) => (
            <tr key={d.id} data-testid={`delivery-${d.id}`}>
              <td className="px-2 py-1.5 whitespace-nowrap text-muted">{when(d.createdAt)}</td>
              <td className="px-2 py-1.5 font-mono">{d.event}</td>
              <td className="px-2 py-1.5">
                <Badge tone={DELIVERY_TONE[d.status]}>{d.status}</Badge>
                {d.error && <span className="ms-1 text-danger-600">{d.error}</span>}
              </td>
              <td className="num px-2 py-1.5">{d.attempts}</td>
              <td className="px-2 py-1.5 text-end">
                {canEdit && d.status !== 'success' && (
                  <Button write size="xs" variant="secondary" loading={retry.isPending && retry.variables === d.id} onClick={() => retry.mutate(d.id, { onSuccess: (r) => (r.status === 'success' ? toast.success('Delivered on retry') : toast.error('Still failing', r.error ?? '')), onError: (e) => toast.error('Couldn’t retry', e.message) })}>
                    <RotateCw />
                    Retry
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {(q.data ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-3 text-center text-muted">
                No deliveries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
