import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Plus, Star, Trash2, Wallet } from 'lucide-react'
import { VENDOR_CATEGORY_LABEL } from '@/modules/events/libraryTypes'
import { useVendorsQuery } from '@/modules/events/hooks/useEventLibrary'
import { RateVendorModal } from '@/modules/events/components/library/RateVendorModal'
import { financeBillPath, vendorPath } from '@/app/paths'
import type { BudgetCategory, EventDetail } from '@/modules/events/types'
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABEL } from '@/modules/events/types'
import { useBudgetQuery, useLinkCampaign, useRemoveBudgetLine, useSaveBudgetLine } from '@/modules/events/hooks/useEventsAdvanced'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { useMarketingAccess, useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { useEntitlements } from '@/modules/billing/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextInput } from '@/shared/components/form/Field'

/** Budget: planned vs actual per category, totals vs the event budget, and the Marketing campaign link (actuals post as campaign costs). */
export function BudgetTab({ event: e }: { event: EventDetail }) {
  const q = useBudgetQuery(e.id)
  const save = useSaveBudgetLine()
  const remove = useRemoveBudgetLine()
  const toast = useToast()
  const [draft, setDraft] = useState({ category: 'venue' as BudgetCategory, planned: '', actual: '', note: '', vendorId: '' })
  // Vendor library (readable by marketing and event teams); without access the picker isn't shown.
  const vendors = useVendorsQuery(!!q.data?.canManage)
  const [rating, setRating] = useState<{ vendorId: string; vendorName: string } | null>(null)
  if (q.isPending) return <Skeleton className="h-64 rounded-card" />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const b = q.data
  const onError = (err: Error) => toast.error('Not saved', err.message)
  const toRate = b.canManage ? (b.vendorsToRate ?? []) : []

  function add(ev: FormEvent) {
    ev.preventDefault()
    save.mutate(
      { id: e.id, input: { category: draft.category, planned: Number(draft.planned || 0), actual: Number(draft.actual || 0), note: draft.note, ...(draft.vendorId ? { vendorId: draft.vendorId } : {}) } },
      { onSuccess: () => setDraft({ category: draft.category, planned: '', actual: '', note: '', vendorId: '' }), onError },
    )
  }

  return (
    <div className="space-y-6">
      <section aria-label="Budget totals" className="grid grid-cols-1 gap-5 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Planned" icon={<Wallet />} value={moneyIn(b.plannedTotal, b.currency)} hint={b.budget === null ? 'No event budget set' : `Event budget ${moneyIn(b.budget, b.currency)}`} />
        <StatCard label="Actual" icon={<Wallet />} value={moneyIn(b.actualTotal, b.currency)} hint={b.remaining === null ? undefined : b.remaining >= 0 ? `${moneyIn(b.remaining, b.currency)} left` : `${moneyIn(-b.remaining, b.currency)} over budget`} />
        {b.sponsorshipIncome != null && <StatCard label="Sponsorship income" icon={<Wallet />} value={moneyIn(b.sponsorshipIncome, b.currency)} hint="Signed + paid sponsors; counted in the ROI" />}
        {!!b.billedTotal && (
          <StatCard
            label="Billed through finance"
            icon={<Wallet />}
            value={moneyIn(b.billedTotal, b.currency)}
            hint={`Event cost without double counting: ${moneyIn(b.costTotal ?? b.actualTotal, b.currency)}${b.unlinkedBilled ? ` · ${moneyIn(b.unlinkedBilled, b.currency)} billed without a line` : ''}`}
          />
        )}
        <StatCard label="Posted to the campaign" icon={<Link2 />} value={b.campaignName ? moneyIn(b.postedTotal, b.currency) : '—'} hint={b.campaignName ?? 'Not linked to a campaign'} />
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="self-start">
          <CardHeader title="Budget lines" icon={<Wallet />} />
          <table className="w-full text-[0.8125rem]" aria-label="Budget lines">
            <thead className="border-y border-line bg-sunken/50 text-xs text-muted">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Category</th>
                <th className="px-3 py-2 text-end font-medium">Planned</th>
                <th className="px-3 py-2 text-end font-medium">Actual</th>
                <th className="px-3 py-2 text-end font-medium" title="Posted supplier bills charged to the line (Accounts & finance). The line costs max(actual, billed).">Billed</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-4 text-muted">No budget lines yet.</td>
                </tr>
              )}
              {b.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-2">
                    <p className="font-medium">{BUDGET_CATEGORY_LABEL[l.category]}</p>
                    {l.note && <p className="text-xs text-muted">{l.note}</p>}
                    {l.vendorId && (
                      <Link to={vendorPath(l.vendorId)} className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                        {l.vendorName}
                      </Link>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-end">{moneyIn(l.planned, b.currency)}</td>
                  <td className="num px-3 py-2 text-end">
                    {b.canManage && !l.source ? (
                      <TextInput
                        aria-label={`Actual ${BUDGET_CATEGORY_LABEL[l.category]}`}
                        type="number"
                        min={0}
                        defaultValue={l.actual}
                        className="ms-auto h-7 w-28 text-end"
                        onBlur={(ev) => Number(ev.target.value) !== l.actual && save.mutate({ id: e.id, lineId: l.id, input: { actual: Number(ev.target.value || 0) } }, { onError })}
                      />
                    ) : (
                      moneyIn(l.actual, b.currency)
                    )}
                  </td>
                  <td className="num px-3 py-2 text-end" data-testid={`billed-${l.id}`}>
                    {l.billed ? moneyIn(l.billed, b.currency) : <span className="text-subtle">—</span>}
                    {(l.bills ?? []).map((x) => (
                      <Link key={x.id} to={financeBillPath(x.id)} className="block text-xs text-brand-700 hover:underline dark:text-brand-300">
                        {x.number}
                      </Link>
                    ))}
                  </td>
                  <td className="px-5 py-2 text-end">
                    {l.source && <Badge tone="sky">From {l.source.kind === 'trip' ? 'a trip' : 'a shipment'}</Badge>}
                    {l.posted && <Badge tone="green">Posted</Badge>}
                    {b.canManage && !l.source && (
                      <Button write variant="ghost" size="xs" iconOnly aria-label={`Remove ${BUDGET_CATEGORY_LABEL[l.category]}`} onClick={() => remove.mutate({ id: e.id, lineId: l.id }, { onError })}>
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.canManage && (
            <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t border-line p-4 sm:grid-cols-[9rem_7rem_7rem_minmax(0,1fr)_auto]" aria-label="Add a budget line">
              <SelectInput aria-label="Category" value={draft.category} onChange={(ev) => setDraft((d) => ({ ...d, category: ev.target.value as BudgetCategory }))}>
                {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{BUDGET_CATEGORY_LABEL[c]}</option>)}
              </SelectInput>
              <TextInput aria-label="Planned" type="number" min={0} placeholder="Planned" value={draft.planned} onChange={(ev) => setDraft((d) => ({ ...d, planned: ev.target.value }))} />
              <TextInput aria-label="Actual" type="number" min={0} placeholder="Actual" value={draft.actual} onChange={(ev) => setDraft((d) => ({ ...d, actual: ev.target.value }))} />
              <TextInput aria-label="Note" placeholder="Note" value={draft.note} onChange={(ev) => setDraft((d) => ({ ...d, note: ev.target.value }))} />
              {vendors.data && (
                <SelectInput aria-label="Vendor" className="col-span-2 sm:col-span-4" value={draft.vendorId} onChange={(ev) => setDraft((d) => ({ ...d, vendorId: ev.target.value }))}>
                  <option value="">No vendor</option>
                  {vendors.data.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.status === 'blacklisted'}>
                      {v.name} · {VENDOR_CATEGORY_LABEL[v.category]}
                      {v.status === 'blacklisted' ? ' — blacklisted, can’t be picked' : v.status === 'preferred' ? ' · preferred' : ''}
                    </option>
                  ))}
                </SelectInput>
              )}
              <Button write type="submit" size="sm" loading={save.isPending}>
                <Plus />
                Add
              </Button>
            </form>
          )}
        </Card>
        <div className="space-y-6 self-start">
          {toRate.length > 0 && (
            <Card>
              <CardHeader title="Rate after the event" icon={<Star />} description="How did these vendors do? Ratings show on their vendor pages." />
              <CardBody>
                <ul className="space-y-2" aria-label="Vendors to rate">
                  {toRate.map((v) => (
                    <li key={v.vendorId} className="flex items-center gap-2 text-[0.8125rem]">
                      <Link to={vendorPath(v.vendorId)} className="min-w-0 flex-1 truncate font-medium hover:underline">{v.vendorName}</Link>
                      <Button write variant="secondary" size="xs" onClick={() => setRating(v)}>
                        <Star />
                        Rate
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <CampaignCard event={e} campaignId={b.campaignId} canManage={b.canManage} />
        </div>
      </div>
      {rating && <RateVendorModal vendorId={rating.vendorId} vendorName={rating.vendorName} eventId={e.id} eventName={e.name} onClose={() => setRating(null)} />}
    </div>
  )
}

function CampaignCard({ event: e, campaignId, canManage }: { event: EventDetail; campaignId: string | null; canManage: boolean }) {
  const access = useMarketingAccess()
  const ent = useEntitlements()
  const options = useMarketingOptions()
  const link = useLinkCampaign()
  const toast = useToast()
  const available = ent.hasModule('marketing') && access.canView
  return (
    <Card className="self-start">
      <CardHeader title="Marketing campaign" icon={<Link2 />} description="Linked: each line’s actual cost is posted to the campaign’s costs (kept in step). Unlinking keeps what was posted." />
      <CardBody>
        {!available ? (
          <p className="text-[0.8125rem] text-muted">Campaigns are part of Marketing.</p>
        ) : (
          <SelectInput
            aria-label="Campaign"
            value={campaignId ?? ''}
            disabled={!canManage || link.isPending}
            onChange={(ev) =>
              link.mutate(
                { id: e.id, campaignId: ev.target.value || null },
                { onSuccess: (r) => toast.success(r.campaignName ? `Linked to ${r.campaignName}` : 'Campaign unlinked'), onError: (err) => toast.error('Not changed', err.message) },
              )
            }
          >
            <option value="">Not linked</option>
            {(options.data?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        )}
      </CardBody>
    </Card>
  )
}
