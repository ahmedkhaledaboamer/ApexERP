import { useState } from 'react'
import { CreditCard, FlaskConical, Star, Unplug } from 'lucide-react'
import type { Gateway, GatewayProvider } from '@/modules/integrations/types'
import { GATEWAY_LABEL } from '@/modules/integrations/types'
import { integrationsApi, useIntegrationMutation, usePayments } from '@/modules/integrations/api'
import { CopyField } from '@/modules/marketing/growth/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { Facts, IntegrationStatusBadge, Section, when } from './shared'

const CURRENCIES = ['AED', 'SAR', 'USD', 'EUR', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP']

/** Payment gateways for finance payment links: Telr, Tap, PayTabs, Stripe (keys write-only), default, test. */
export function PaymentsPanel({ canEdit }: { canEdit: boolean }) {
  const q = usePayments()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-5">
      <p className="text-[0.8125rem] text-muted">
        Payment links on invoices (Accounts & finance › Collections) use the default gateway.{' '}
        {q.data.defaultProvider ? (
          <strong data-testid="default-gateway">{GATEWAY_LABEL[q.data.defaultProvider]}</strong>
        ) : (
          'None is connected yet: links use the built-in test checkout.'
        )}
      </p>
      {q.data.gateways.map((g) => (
        <GatewayCard key={g.provider} g={g} canEdit={canEdit} />
      ))}
    </div>
  )
}

function GatewayCard({ g, canEdit }: { g: Gateway; canEdit: boolean }) {
  const toast = useToast()
  const save = useIntegrationMutation((v: Parameters<typeof integrationsApi.saveGateway>[1]) => integrationsApi.saveGateway(g.provider, v))
  const remove = useIntegrationMutation((p: GatewayProvider) => integrationsApi.removeGateway(p))
  const makeDefault = useIntegrationMutation((p: GatewayProvider) => integrationsApi.defaultGateway(p))
  const test = useIntegrationMutation((p: GatewayProvider) => integrationsApi.testGateway(p))
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({ merchantId: g.merchantId ?? '', secretKey: '', mode: g.mode, currency: g.currency ?? 'AED' })
  const err = (t: string) => (e: Error) => toast.error(t, e.message)
  return (
    <Section
      title={GATEWAY_LABEL[g.provider]}
      action={
        <span className="flex items-center gap-2">
          {g.isDefault && <Badge tone="brand" icon={<Star />}>Default</Badge>}
          <IntegrationStatusBadge status={g.status} />
        </span>
      }
    >
      {g.status === 'connected' && (
        <Facts
          rows={[
            ['Merchant id', g.merchantId ?? '—'],
            ['Mode', g.mode === 'test' ? 'Test' : 'Live'],
            ['Currency', g.currency ?? '—'],
            ['Secret key', g.secretKeyHint ?? '—'],
            ['Last test', g.lastTestAt ? `${when(g.lastTestAt)} · ${g.lastTestStatus === 'success' ? 'approved' : 'failed'}` : 'Never'],
          ]}
        />
      )}
      {g.status === 'connected' && <CopyField label="Webhook URL (paste in the gateway dashboard)" value={g.webhookUrl} />}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button write size="sm" variant="secondary" onClick={() => setEditing((x) => !x)}>
            <CreditCard />
            {g.status === 'connected' ? 'Configure' : 'Connect'}
          </Button>
          {g.status === 'connected' && (
            <>
              <Button write size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate(g.provider, { onSuccess: (r) => { const x = r.gateways.find((y) => y.provider === g.provider); if (x?.lastTestStatus === 'success') toast.success('Test transaction approved'); else toast.error('Test transaction declined') }, onError: err('Test failed') })}>
                <FlaskConical />
                Test transaction
              </Button>
              {!g.isDefault && (
                <Button write size="sm" variant="secondary" loading={makeDefault.isPending} onClick={() => makeDefault.mutate(g.provider, { onSuccess: () => toast.success(`${GATEWAY_LABEL[g.provider]} is now the default`), onError: err('Couldn’t change') })}>
                  <Star />
                  Make default
                </Button>
              )}
              <Button write size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(g.provider, { onSuccess: () => toast.success('Gateway disconnected'), onError: err('Couldn’t disconnect') })}>
                <Unplug />
                Disconnect
              </Button>
            </>
          )}
        </div>
      )}
      {canEdit && editing && (
        <form
          className="grid grid-cols-1 gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(
              { ...f, secretKey: f.secretKey || undefined },
              { onSuccess: () => { setEditing(false); setF((x) => ({ ...x, secretKey: '' })); toast.success(`${GATEWAY_LABEL[g.provider]} saved`) }, onError: err('Couldn’t save') },
            )
          }}
        >
          <Field id={`gw-${g.provider}-merchant`} label="Merchant / account id" required>
            <TextInput id={`gw-${g.provider}-merchant`} value={f.merchantId} onChange={(e) => setF((x) => ({ ...x, merchantId: e.target.value }))} />
          </Field>
          <Field id={`gw-${g.provider}-secret`} label="Secret key" hint={g.secretKeyHint ? `Stored (${g.secretKeyHint}). Leave empty to keep it.` : 'Write-only.'}>
            <TextInput id={`gw-${g.provider}-secret`} type="password" autoComplete="new-password" value={f.secretKey} onChange={(e) => setF((x) => ({ ...x, secretKey: e.target.value }))} />
          </Field>
          <Field id={`gw-${g.provider}-mode`} label="Mode">
            <SelectInput id={`gw-${g.provider}-mode`} value={f.mode} onChange={(e) => setF((x) => ({ ...x, mode: e.target.value as 'test' | 'live' }))}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </SelectInput>
          </Field>
          <Field id={`gw-${g.provider}-currency`} label="Currency">
            <SelectInput id={`gw-${g.provider}-currency`} value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value }))}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="sm:col-span-2">
            <Button write type="submit" size="sm" loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}
