import { useSearchParams, Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarDays, CreditCard, Globe, KeyRound, Mail, Megaphone, MessageCircle, Pause, Play, Plug, Webhook } from 'lucide-react'
import type { IntegrationCard, IntegrationKey } from '@/modules/integrations/types'
import { INTEGRATION_GROUPS, INTEGRATION_LABEL, PAUSABLE } from '@/modules/integrations/types'
import { integrationsApi, useIntegrationMutation, useIntegrationsAccess, useOverview } from '@/modules/integrations/api'
import { MARKETING_PATHS } from '@/modules/marketing/paths'
import { PageBody, PageHeader, IconTile } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { IntegrationStatusBadge, when } from '@/modules/integrations/components/shared'
import { EmailPanel } from '@/modules/integrations/components/EmailPanel'
import { WebsitePanel } from '@/modules/integrations/components/WebsitePanel'
import { WhatsAppPanel } from '@/modules/integrations/components/WhatsAppPanel'
import { CalendarPanel } from '@/modules/integrations/components/CalendarPanel'
import { PaymentsPanel } from '@/modules/integrations/components/PaymentsPanel'
import { ApiKeysPanel, WebhooksPanel } from '@/modules/integrations/components/DeveloperPanel'
import { EmailLogTab, SyncLogTab } from '@/modules/integrations/components/Logs'

type Tab = 'overview' | 'sync-log' | 'email-log'
const ICONS: Record<IntegrationKey, typeof Mail> = { email: Mail, whatsapp: MessageCircle, website: Globe, calendar: CalendarDays, payments: CreditCard, ads: Megaphone, api: KeyRound, webhooks: Webhook }
const DESCRIPTION: Record<IntegrationKey, string> = {
  email: 'SMTP, Google Workspace or Microsoft 365, domain authentication and default senders.',
  whatsapp: 'WhatsApp Business Cloud API: number, message templates and inbound chats.',
  website: 'Embed your lead forms, or post any form tool to a webhook that creates leads.',
  calendar: 'Each person syncs tasks and meetings with Google or Outlook.',
  payments: 'Telr, Tap, PayTabs or Stripe for invoice payment links.',
  ads: 'Meta, Google, LinkedIn and TikTok ad accounts (Marketing).',
  api: 'Keys for your own systems, scoped per module.',
  webhooks: 'Signed events (lead created, deal won, invoice issued…) to your URL.',
}

/** Insights & admin › Integrations: a card per connector, grouped; the sync log and the email log. */
export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (['overview', 'sync-log', 'email-log'].includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as Tab
  const open = params.get('open') as IntegrationKey | null
  const q = useOverview()
  const { canEdit } = useIntegrationsAccess()
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        icon={
          <IconTile tone="brand">
            <Plug />
          </IconTile>
        }
        title="Integrations"
        description="Connect email, WhatsApp, website forms, calendars, payment gateways and your own systems. Status and sync log."
      />
      <PageBody className="space-y-5">
        <Tabs<Tab>
          label="Integrations sections"
          value={tab}
          onChange={(t) => set({ tab: t === 'overview' ? null : t })}
          items={[
            { id: 'overview', label: 'Connectors' },
            { id: 'sync-log', label: 'Sync log', count: q.data?.recentErrors || undefined },
            { id: 'email-log', label: 'Email log' },
          ]}
        />
        {tab === 'sync-log' ? (
          <SyncLogTab />
        ) : tab === 'email-log' ? (
          <EmailLogTab />
        ) : q.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : q.isError ? (
          <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
        ) : q.data.cards.length === 0 ? (
          <EmptyState title="No integrations" body="Nothing to connect yet." />
        ) : (
          <div className="space-y-6">
            {q.data.recentErrors > 0 && (
              <button type="button" onClick={() => set({ tab: 'sync-log' })} className="flex w-full items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2.5 text-start text-[0.8125rem] text-danger-700 dark:border-danger-500/30 dark:bg-danger-500/10 dark:text-danger-500">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {q.data.recentErrors} failed sync{q.data.recentErrors === 1 ? '' : 's'} in the last 7 days. Open the sync log.
              </button>
            )}
            {INTEGRATION_GROUPS.map((g) => {
              const cards = q.data.cards.filter((c) => c.group === g.key)
              if (!cards.length) return null
              return (
                <section key={g.key} aria-label={g.label} className="space-y-3">
                  <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</h2>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {cards.map((c) => (
                      <ConnectorCard key={c.key} card={c} canEdit={canEdit} onOpen={() => set({ open: c.key })} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </PageBody>
      <Drawer open={!!open && open !== 'ads'} onClose={() => set({ open: null })} title={open ? INTEGRATION_LABEL[open] : ''} description={open ? DESCRIPTION[open] : undefined} width="xl">
        {open === 'email' && <EmailPanel canEdit={canEdit} />}
        {open === 'website' && <WebsitePanel canEdit={canEdit} />}
        {open === 'whatsapp' && <WhatsAppPanel canEdit={canEdit} />}
        {open === 'calendar' && <CalendarPanel />}
        {open === 'payments' && <PaymentsPanel canEdit={canEdit} />}
        {open === 'api' && <ApiKeysPanel canEdit={canEdit} />}
        {open === 'webhooks' && <WebhooksPanel canEdit={canEdit} />}
      </Drawer>
    </>
  )
}

function ConnectorCard({ card, canEdit, onOpen }: { card: IntegrationCard; canEdit: boolean; onOpen: () => void }) {
  const toast = useToast()
  const Icon = ICONS[card.key]
  const pause = useIntegrationMutation((paused: boolean) => integrationsApi.setPaused(card.key, paused))
  const pausable = canEdit && PAUSABLE.includes(card.key) && card.status !== 'not_connected'
  return (
    <Card aria-label={card.name} data-integration={card.key}>
      <CardBody className="flex h-full flex-col gap-3 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
            <Icon className="size-[1.125rem]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[0.875rem] font-semibold text-ink">{card.name}</h3>
              <IntegrationStatusBadge status={card.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted">{DESCRIPTION[card.key]}</p>
          </div>
        </div>
        <p className="text-[0.8125rem] text-ink-2" data-testid={`summary-${card.key}`}>
          {card.summary}
        </p>
        {card.problem && <p className="text-xs text-danger-600">{card.problem}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Last activity {when(card.lastSyncAt)}</span>
          <span className="ms-auto flex gap-2">
            {pausable && (
              <Button write size="sm" variant="ghost" loading={pause.isPending} onClick={() => pause.mutate(card.status !== 'paused', { onSuccess: () => toast.success(card.status === 'paused' ? 'Resumed' : 'Paused'), onError: (e) => toast.error('Couldn’t change it', e.message) })}>
                {card.status === 'paused' ? <Play /> : <Pause />}
                {card.status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
            )}
            {card.key === 'ads' ? (
              <Link to={MARKETING_PATHS.ads} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[0.8125rem] text-ink shadow-xs hover:bg-hover">
                Open Ads Integrations
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={onOpen} aria-label={`${card.status === 'not_connected' && canEdit ? 'Connect' : 'Configure'} ${card.name}`}>
                {card.status === 'not_connected' && canEdit ? 'Connect' : canEdit ? 'Configure' : 'View'}
              </Button>
            )}
          </span>
        </div>
      </CardBody>
    </Card>
  )
}
