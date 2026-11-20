import { useState } from 'react'
import { Handshake, Package, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import type { SponsorPackage } from '@/modules/events/sponsorTypes'
import { useDeletePackage, useSponsorshipQuery } from '@/modules/events/hooks/useSponsorsLogistics'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { SponsorStageBadge, offsetLabel } from '@/modules/events/components/sponsorMeta'
import { NewSponsorModal, PackageModal } from '@/modules/events/components/SponsorForms'
import { SponsorDrawer } from '@/modules/events/components/SponsorDrawer'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'

/** The event's "Sponsors" tab (organized events): packages, sponsors and their deliverables, sponsorship income. */
export function SponsorsTab({ event: e }: { event: EventDetail }) {
  const q = useSponsorshipQuery(e.id)
  const removePackage = useDeletePackage()
  const toast = useToast()
  const [editing, setEditing] = useState<SponsorPackage | 'new' | null>(null)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  if (q.isPending) return <Skeleton className="h-64 rounded-card" />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const s = q.data
  if (!s.isOrganizer) return <EmptyState icon={<Handshake />} title="Sponsors are for events you organize" body="This event is one your company attends. Its costs are on the Budget and Logistics tabs." />
  const won = s.deals.filter((d) => d.stage === 'signed' || d.stage === 'paid').length

  return (
    <div className="space-y-6">
      <section aria-label="Sponsorship income" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard label="Sponsorship income" icon={<Wallet />} value={moneyIn(s.income.total, s.currency)} hint="Signed + paid; counted in the event’s ROI" />
        <StatCard label="Paid" icon={<Wallet />} value={moneyIn(s.income.paid, s.currency)} hint={`${moneyIn(s.income.signed, s.currency)} signed, not paid yet`} />
        <StatCard label="Sponsors signed" icon={<Handshake />} value={won} hint={`${s.deals.filter((d) => d.stage !== 'lost').length - won} in the pipeline`} />
      </section>

      <Card>
        <CardHeader
          title="Packages"
          icon={<Package />}
          action={s.canManage && (
            <Button write size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus />
              New package
            </Button>
          )}
        />
        {s.packages.length === 0 ? (
          <p className="px-5 pb-5 text-[0.8125rem] text-muted">No packages yet: add Platinum, Gold, Exhibitor booth…</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Sponsorship packages">
            {s.packages.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="num text-[0.8125rem] text-ink-2">{moneyIn(p.price, p.currency)}</p>
                  </div>
                  <Badge tone={p.remaining === 0 ? 'red' : 'green'}>{p.remaining === 0 ? 'Sold out' : `${p.remaining} of ${p.quantity} left`}</Badge>
                  {s.canManage && (
                    <>
                      <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>
                      <Button
                        write
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label={`Delete ${p.name}`}
                        onClick={() => removePackage.mutate({ eventId: e.id, packageId: p.id }, { onSuccess: () => toast.success('Package deleted'), onError: (err) => toast.error('Not deleted', err.message) })}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                {p.benefits.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs text-ink-2">
                    {p.benefits.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                )}
                {p.deliverables.length > 0 && (
                  <p className="mt-2 text-xs text-muted">Deliverables: {p.deliverables.map((d) => `${d.title} (${offsetLabel(d.offsetDays)})`).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Sponsors & exhibitors"
          icon={<Handshake />}
          action={s.canManage && s.packages.length > 0 && (
            <Button write size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add sponsor
            </Button>
          )}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Sponsors">
            <thead className="border-y border-line bg-sunken/50 text-xs text-muted">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Organization</th>
                <th className="px-3 py-2 text-start font-medium">Package</th>
                <th className="px-3 py-2 text-start font-medium">Stage</th>
                <th className="px-3 py-2 text-end font-medium">Amount</th>
                <th className="px-3 py-2 text-start font-medium">Deliverables</th>
                <th className="px-5 py-2 text-start font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.deals.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-4 text-muted">No sponsors yet.</td></tr>
              )}
              {s.deals.map((d) => {
                const done = d.deliverables.filter((x) => x.status === 'done').length
                const overdue = d.deliverables.filter((x) => x.overdue).length
                return (
                  <tr key={d.id} className="cursor-pointer hover:bg-hover" onClick={() => setOpen(d.id)}>
                    <td className="px-5 py-2">
                      <button type="button" className="font-medium hover:underline" onClick={(ev) => { ev.stopPropagation(); setOpen(d.id) }}>{d.organizationName}</button>
                      {d.contactName && <p className="text-xs text-muted">{d.contactName}</p>}
                    </td>
                    <td className="px-3 py-2">{d.packageName}</td>
                    <td className="px-3 py-2"><SponsorStageBadge stage={d.stage} /></td>
                    <td className="num px-3 py-2 text-end">{moneyIn(d.amount, d.currency)}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.deliverables.length ? `${done} of ${d.deliverables.length} done` : '—'}
                      {overdue > 0 && <Badge tone="red" className="ms-2">{overdue} overdue</Badge>}
                    </td>
                    <td className="px-5 py-2 text-ink-2">{d.ownerName || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && <PackageModal eventId={e.id} currency={s.currency} pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {adding && (
        <NewSponsorModal
          eventId={e.id}
          events={[{ id: e.id, name: e.name, startDate: e.startDate, canManage: true }]}
          packages={s.packages}
          onClose={() => setAdding(false)}
          onCreated={(id) => setOpen(id)}
        />
      )}
      <SponsorDrawer eventId={e.id} sponsorId={open} packages={s.packages} onClose={() => setOpen(null)} />
    </div>
  )
}
