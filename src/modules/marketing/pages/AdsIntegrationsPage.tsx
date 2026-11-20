import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Lock, Plug, Plus, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import {
  AD_OBJECTIVE_LABEL,
  AD_PROVIDERS,
  AD_PROVIDER_LABEL,
  LEAD_AD_PROVIDERS,
  LEAD_OUTCOME_LABEL,
  type AdConnection,
  type AdConnectionDetail,
  type AdProvider,
  type LeadSubmissionOutcome,
} from '@/modules/marketing/adsTypes'
import {
  useAdAccounts,
  useAdConnection,
  useAdConnections,
  useAdsAccess,
  useConnectAdAccount,
  useDisconnectAdAccount,
  useMapAdCampaign,
  useSyncAdConnection,
} from '@/modules/marketing/hooks/useAds'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { useBillingAccess, useEntitlements } from '@/modules/billing/hooks'
import { SETTINGS_PATHS } from '@/modules/settings/components/SettingsLayout'
import { leadPath } from '@/app/paths'
import { cn, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SelectInput } from '@/shared/components/form/Field'
import { AXIS_TICK, C, CURSOR, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'

const DATE_TIME = 'd MMM yyyy, HH:mm'
const PROVIDER_BLURB: Record<AdProvider, string> = {
  meta: 'Facebook and Instagram campaigns, spend and lead-form leads.',
  google: 'Search and Performance Max campaigns, spend and conversions.',
  linkedin: 'Sponsored content and Lead Gen Form leads.',
  tiktok: 'In-feed and Spark ads campaigns and spend.',
}
const PROVIDER_DOT: Record<AdProvider, string> = { meta: 'bg-accent-500', google: 'bg-warning-500', linkedin: 'bg-info-500', tiktok: 'bg-pink-500' }
const STATUS_TONE: Record<AdConnection['status'], Tone> = { connected: 'green', error: 'red', disconnected: 'neutral' }
const OUTCOME_TONE: Record<LeadSubmissionOutcome, Tone> = { created: 'green', duplicate: 'blue', limit: 'amber', pending_source: 'amber' }
const money = (n: number | null, cur: string) => (n === null ? '—' : fmtMoney(n, cur))
const int = (n: number) => new Intl.NumberFormat('en-US').format(n)

export default function AdsIntegrationsPage() {
  const { canView } = useAdsAccess()
  if (!canView) return <NoMarketingAccess what="Ads Integrations" />
  return <AdsIntegrations />
}

function AdsIntegrations() {
  const { canEdit } = useAdsAccess()
  const ent = useEntitlements()
  const integrations = ent.hasModule('integrations')
  const query = useAdConnections()
  const [connecting, setConnecting] = useState<AdProvider | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useMemo(() => query.data ?? [], [query.data])
  const live = list.filter((c) => c.status !== 'disconnected')
  const currency = list[0]?.currency
  const totals = live.reduce((s, c) => ({ spend: s.spend + c.last30.spend, clicks: s.clicks + c.last30.clicks, leads: s.leads + c.last30.leads }), { spend: 0, clicks: 0, leads: 0 })
  const canConnect = canEdit && integrations

  return (
    <>
      <PageHeader
        title="Ads Integrations"
        description="Connect ad accounts to sync campaigns, daily spend and lead-form leads into the CRM."
        icon={<Plug aria-hidden />}
      />
      <PageBody className="space-y-6">
        {!integrations && !ent.loading && <IntegrationsUpsell />}
        {query.isPending ? (
          <Skeleton className="h-64 rounded-card" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Connected accounts" value={live.length} hint={`${list.length - live.length} disconnected`} icon={<Plug aria-hidden />} />
              <StatCard label="Ad spend, last 30 days" value={currency ? fmtMoney(totals.spend, currency) : '—'} hint="Synced complete days" />
              <StatCard label="Clicks, last 30 days" value={int(totals.clicks)} />
              <StatCard label="Lead-form leads, last 30 days" value={int(totals.leads)} hint="Meta and LinkedIn lead forms" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {AD_PROVIDERS.map((p) => (
                <ProviderCard
                  key={p}
                  provider={p}
                  connections={list.filter((c) => c.provider === p)}
                  canConnect={canConnect}
                  connectHint={!canEdit ? 'Your role can view ad integrations but not connect them.' : !integrations ? 'Connecting needs the Integrations module.' : undefined}
                  onConnect={() => setConnecting(p)}
                  onOpen={setOpenId}
                />
              ))}
            </div>
          </>
        )}
      </PageBody>
      <ConnectDialog provider={connecting} onClose={() => setConnecting(null)} onConnected={(id) => setOpenId(id)} />
      <ConnectionDrawer id={openId} onClose={() => setOpenId(null)} canEdit={canEdit} integrations={integrations} />
    </>
  )
}

/** The plan lacks `integrations`: connecting is locked (synced history stays readable). */
function IntegrationsUpsell() {
  const { canManage } = useBillingAccess()
  return (
    <Card id="ads-upgrade" className="border-dashed">
      <CardBody className="flex flex-wrap items-center gap-4 pt-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Lock className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.875rem] font-semibold text-ink">Connecting ad accounts needs the Integrations module</p>
          <p className="text-[0.8125rem] text-muted">
            Your plan doesn’t include Integrations. Accounts already connected keep their synced history, but new connections and syncs are paused.
            {canManage ? '' : ' Ask your company administrator to upgrade.'}
          </p>
        </div>
        {canManage && (
          <Link to={SETTINGS_PATHS.billing} className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700 hover:underline dark:text-brand-300">
            View plans
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        )}
      </CardBody>
    </Card>
  )
}

function ProviderCard({
  provider,
  connections,
  canConnect,
  connectHint,
  onConnect,
  onOpen,
}: {
  provider: AdProvider
  connections: AdConnection[]
  canConnect: boolean
  connectHint?: string
  onConnect: () => void
  onOpen: (id: string) => void
}) {
  return (
    <Card aria-label={AD_PROVIDER_LABEL[provider]} data-provider={provider}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className={cn('size-2.5 rounded-full', PROVIDER_DOT[provider])} aria-hidden />
            {AD_PROVIDER_LABEL[provider]}
            {LEAD_AD_PROVIDERS.includes(provider) && (
              <Badge tone="brand" className="ms-1">
                Lead ads
              </Badge>
            )}
          </span>
        }
        description={PROVIDER_BLURB[provider]}
        action={
          <Button write size="sm" variant="secondary" disabled={!canConnect} title={connectHint} onClick={onConnect}>
            <Plus />
            Connect
          </Button>
        }
      />
      <CardBody>
        {connections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[0.8125rem] text-muted">No account connected.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {connections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-medium text-ink">{c.accountName}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="num">{c.accountId}</span> · {c.mapped}/{c.campaigns} campaigns mapped
                      {c.lastSyncAt ? ` · synced ${fmtDate(c.lastSyncAt, DATE_TIME)}` : ''}
                    </p>
                  </div>
                  <span className="num text-[0.8125rem] text-ink-2">{fmtMoney(c.last30.spend, c.currency)}</span>
                  {c.pendingLeads > 0 && <Badge tone="amber">{c.pendingLeads} leads waiting</Badge>}
                  <Badge tone={STATUS_TONE[c.status]}>{c.status === 'error' ? 'Sync error' : c.status === 'connected' ? 'Connected' : 'Disconnected'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** Mock OAuth: "sign in" with the provider, pick an ad account the login can see, consent, connect. */
function ConnectDialog({ provider, onClose, onConnected }: { provider: AdProvider | null; onClose: () => void; onConnected: (id: string) => void }) {
  const toast = useToast()
  const accounts = useAdAccounts(provider, !!provider)
  const connect = useConnectAdAccount()
  const [accountId, setAccountId] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setAccountId('')
    setConsent(false)
    setError('')
  }, [provider])
  if (!provider) return null
  const label = AD_PROVIDER_LABEL[provider]

  function submit() {
    if (!accountId) return setError('Pick the ad account to connect.')
    if (!consent) return setError('Allow access to connect the account.')
    connect.mutate(
      { provider: provider!, accountId, consent },
      {
        onSuccess: (c) => {
          toast.success(`${c.accountName} connected`, `${c.runs[0]?.rows ?? 0} days of campaign stats imported.`)
          onClose()
          onConnected(c.id)
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect ${label}`}
      description={`Signed in to ${label} (simulated). Pick the ad account Apex CRM may read.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write onClick={submit} loading={connect.isPending} disabled={!accountId || !consent}>
            Connect account
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {accounts.isPending ? (
          <Skeleton className="h-28" />
        ) : accounts.isError ? (
          <ErrorState message={accounts.error.message} />
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[0.8125rem] font-medium text-ink">Ad account</legend>
            {accounts.data.map((a) => (
              <label
                key={a.accountId}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-[0.8125rem] has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50 dark:has-[:checked]:bg-brand-500/10',
                  a.connected && 'cursor-not-allowed opacity-60',
                )}
              >
                <input type="radio" name="ad-account" value={a.accountId} disabled={a.connected} checked={accountId === a.accountId} onChange={() => setAccountId(a.accountId)} className="accent-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{a.name}</span>
                  <span className="num block text-xs text-muted">
                    {a.accountId} · {a.currency}
                  </span>
                </span>
                {a.connected && <Badge tone="green">Connected</Badge>}
              </label>
            ))}
          </fieldset>
        )}
        <div className="rounded-lg bg-sunken p-3 text-[0.8125rem] text-ink-2">
          <p className="mb-2 flex items-center gap-2 font-medium text-ink">
            <ShieldCheck className="size-4 text-success-600" aria-hidden />
            Apex CRM will be able to
          </p>
          <ul className="ms-6 list-disc space-y-0.5">
            <li>read campaigns and daily spend, impressions and clicks</li>
            {LEAD_AD_PROVIDERS.includes(provider) && <li>receive lead-form submissions as leads</li>}
          </ul>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted">
            <KeyRound className="size-3.5" aria-hidden />
            The access token stays on the server; you’ll only see its last 4 characters.
          </p>
        </div>
        <label className="flex items-start gap-2 text-[0.8125rem] text-ink">
          <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" aria-label="Allow access" />
          I allow Apex CRM to access this ad account.
        </label>
        {error && (
          <p role="alert" className="text-[0.8125rem] text-danger-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

type DrawerTab = 'campaigns' | 'leads' | 'syncs'

function ConnectionDrawer({ id, onClose, canEdit, integrations }: { id: string | null; onClose: () => void; canEdit: boolean; integrations: boolean }) {
  const query = useAdConnection(id)
  const sync = useSyncAdConnection()
  const disconnect = useDisconnectAdAccount()
  const toast = useToast()
  const [tab, setTab] = useState<DrawerTab>('campaigns')
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    setTab('campaigns')
    setConfirming(false)
  }, [id])
  const c = query.data
  const live = c && c.status !== 'disconnected'
  const canAct = canEdit && integrations

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="xl"
      title={c ? c.accountName : 'Ad account'}
      description={c ? `${AD_PROVIDER_LABEL[c.provider]} · ${c.accountId} · ${c.currency}` : undefined}
      footer={
        c && canAct && live ? (
          <div className="flex flex-wrap justify-between gap-2">
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-[0.8125rem] text-ink-2">Disconnect? Synced history stays.</span>
                <Button
                  variant="danger"
                  size="sm"
                  loading={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(c.id, {
                      onSuccess: () => {
                        toast.success(`${c.accountName} disconnected`)
                        setConfirming(false)
                      },
                      onError: (e) => toast.error('Couldn’t disconnect', e.message),
                    })
                  }
                >
                  Disconnect
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button write variant="ghost" onClick={() => setConfirming(true)}>
                <Unplug />
                Disconnect
              </Button>
            )}
            <Button
              write
              loading={sync.isPending}
              onClick={() =>
                sync.mutate(c.id, {
                  onSuccess: (d) => {
                    const run = d.runs[0]
                    if (run?.status === 'error') toast.error('Sync failed', run.error ?? undefined)
                    else toast.success('Sync finished', `${run?.rows ?? 0} rows, ${run?.costs ?? 0} cost entries, ${run?.leadsCreated ?? 0} new leads.`)
                  },
                  onError: (e) => toast.error('Couldn’t sync', e.message),
                })
              }
            >
              <RefreshCw />
              {c.status === 'error' ? 'Retry sync' : 'Sync now'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {query.isPending ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : c ? (
        <div className="space-y-5">
          <ConnectionSummary c={c} />
          <Tabs<DrawerTab>
            label="Ad account sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'campaigns', label: 'Campaigns', count: c.adCampaigns.length },
              ...(c.leadAds ? [{ id: 'leads' as const, label: 'Lead forms', count: c.submissions.length }] : []),
              { id: 'syncs', label: 'Sync log', count: c.runs.length },
            ]}
          />
          {tab === 'campaigns' && <AdCampaignsTable c={c} canEdit={canEdit} />}
          {tab === 'leads' && <SubmissionsList c={c} />}
          {tab === 'syncs' && <SyncLog c={c} />}
        </div>
      ) : null}
    </Drawer>
  )
}

function ConnectionSummary({ c }: { c: AdConnectionDetail }) {
  const t = c.last30
  return (
    <div className="space-y-4">
      {c.status === 'error' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-[0.8125rem] text-danger-700 dark:bg-danger-500/15 dark:text-danger-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {c.lastError}
        </div>
      )}
      {c.pendingLeads > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-[0.8125rem] text-warning-700 dark:bg-warning-500/15 dark:text-warning-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {c.pendingLeads} lead-form submissions are waiting for a lead source. {c.submissions.find((s) => s.outcome === 'pending_source')?.message}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 text-[0.8125rem] sm:grid-cols-4" aria-label="Connection">
        <Fact label="Status">
          <Badge tone={STATUS_TONE[c.status]}>{c.status === 'error' ? 'Sync error' : c.status === 'connected' ? 'Connected' : 'Disconnected'}</Badge>
        </Fact>
        <Fact label="Access token">
          <span className="num" data-testid="token-hint">
            {c.tokenHint ?? 'Revoked'}
          </span>
        </Fact>
        <Fact label="Connected by">
          {c.connectedByName} · {fmtDate(c.connectedAt)}
        </Fact>
        <Fact label="Synced through">{c.syncedThrough ? fmtDate(c.syncedThrough) : '—'}</Fact>
      </dl>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Last 30 days">
        <Mini label="Spend" value={fmtMoney(t.spend, c.currency)} />
        <Mini label="Impressions" value={int(t.impressions)} />
        <Mini label="Clicks" value={int(t.clicks)} hint={t.ctr === null ? undefined : `CTR ${t.ctr}%`} />
        <Mini label="Cost per click" value={money(t.cpc, c.currency)} />
        <Mini label="Leads" value={int(t.leads)} hint={`${int(t.conversions)} conversions`} />
      </div>
      {c.daily.length > 0 && (
        <div dir="ltr" className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={c.daily} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(d: string) => d.slice(8)} minTickGap={12} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={AXIS_TICK} />
              <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtMoney(Number(v), c.currency)} />
              <Bar dataKey="spend" name="Spend" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-ink">{children}</dd>
    </div>
  )
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-0.5 text-[0.9375rem] font-semibold text-ink">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

function AdCampaignsTable({ c, canEdit }: { c: AdConnectionDetail; canEdit: boolean }) {
  const options = useMarketingOptions()
  const map = useMapAdCampaign()
  const toast = useToast()
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Map an ad campaign to a CRM campaign: its daily spend becomes campaign costs (one entry per day, never twice) and its lead-form leads are attributed to it. Unmapping stops new costs; existing entries stay.</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[0.8125rem]" aria-label="Ad campaigns">
          <thead className="bg-sunken text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Ad campaign</th>
              <th className="px-3 py-2 text-end font-medium">Spend (30 d)</th>
              <th className="px-3 py-2 text-end font-medium">Clicks</th>
              <th className="px-3 py-2 text-end font-medium">Leads</th>
              <th className="px-3 py-2 text-start font-medium">CRM campaign</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.adCampaigns.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2">
                  <p className="font-medium text-ink">{a.name}</p>
                  <p className="text-xs text-muted">
                    {AD_OBJECTIVE_LABEL[a.objective]} · {a.costEntries} cost entries
                  </p>
                </td>
                <td className="num px-3 py-2 text-end">{fmtMoney(a.totals.spend, c.currency)}</td>
                <td className="num px-3 py-2 text-end">{int(a.totals.clicks)}</td>
                <td className="num px-3 py-2 text-end">{int(a.totals.leads)}</td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <SelectInput
                      aria-label={`CRM campaign for ${a.name}`}
                      value={a.campaignId ?? ''}
                      disabled={map.isPending}
                      onChange={(e) =>
                        map.mutate(
                          { id: a.id, campaignId: e.target.value || null },
                          {
                            onSuccess: (r) => toast.success(r.campaignName ? `Mapped to ${r.campaignName}` : 'Unmapped', r.campaignName ? 'Synced spend is now a campaign cost.' : 'No new costs; existing entries stay.'),
                            onError: (err) => toast.error('Couldn’t map', err.message),
                          },
                        )
                      }
                      className="min-w-[11rem]"
                    >
                      <option value="">Not mapped</option>
                      {(options.data?.campaigns ?? []).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </SelectInput>
                  ) : (
                    <span className={a.campaignName ? 'text-ink' : 'text-muted'}>{a.campaignName ?? 'Not mapped'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SubmissionsList({ c }: { c: AdConnectionDetail }) {
  if (!c.submissions.length) {
    return <EmptyState title="No lead-form submissions yet" body="Submissions after the connection was made arrive with the daily sync and become leads." />
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Lead-form submissions">
      {c.submissions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[0.8125rem]">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink">
              {s.name} · {s.companyName}
            </p>
            <p className="truncate text-xs text-muted">
              {s.email} · {s.adCampaignName} · {fmtDate(s.submittedAt, DATE_TIME)}
            </p>
          </div>
          {s.leadId && (
            <Link to={leadPath(s.leadId)} className="num text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              {s.leadId}
            </Link>
          )}
          <Badge tone={OUTCOME_TONE[s.outcome]}>{LEAD_OUTCOME_LABEL[s.outcome]}</Badge>
        </li>
      ))}
    </ul>
  )
}

function SyncLog({ c }: { c: AdConnectionDetail }) {
  if (!c.runs.length) return <EmptyState title="No syncs yet" body="The first sync runs when the account is connected." />
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Sync log">
      {c.runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-[0.8125rem]">
          {r.status === 'success' ? <CheckCircle2 className="mt-0.5 size-4 text-success-600" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 text-danger-600" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-ink">
              <span className="font-medium capitalize">{r.trigger}</span> sync · {fmtDate(r.startedAt, DATE_TIME)}
            </p>
            <p className="text-xs text-muted">
              {r.status === 'error'
                ? r.error
                : `${r.rows} stat rows · ${r.costs} cost entries · ${r.leadsCreated} new leads · ${r.leadsDuplicate} existing · ${r.leadsPending} waiting${r.leadsSkipped ? ` · ${r.leadsSkipped} over the plan limit` : ''}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
