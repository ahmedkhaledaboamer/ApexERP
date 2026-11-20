import { useState } from 'react'
import { displayMobile } from '@/shared/lib/phone'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarCheck2, ExternalLink, FileText, Pencil, Star, Store, Trash2, Wallet } from 'lucide-react'
import type { VendorSpendRow } from '@/modules/events/libraryTypes'
import { VENDOR_CATEGORY_LABEL } from '@/modules/events/libraryTypes'
import { useDeleteVendor, useVendorQuery } from '@/modules/events/hooks/useEventLibrary'
import { EVENT_STATUS_LABEL, type EventStatus } from '@/modules/events/types'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, VendorStatusBadge } from '@/modules/events/components/library/LibraryBits'
import { RateVendorModal } from '@/modules/events/components/library/RateVendorModal'
import { VendorDrawer } from '@/modules/events/components/library/VendorDrawer'
import { PATHS, eventPath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/** `/events/vendors/:id`: a vendor — spend per event and total (actuals of its budget lines), events worked, reviews. */
export default function VendorDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const query = useVendorQuery(id)
  const remove = useDeleteVendor()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState<VendorSpendRow | null>(null)

  if (query.isPending) return <PageBody><Skeleton className="h-64 rounded-card" /></PageBody>
  if (query.error) return <PageBody><LibraryError error={query.error} onRetry={() => query.refetch()} what="Vendors" /></PageBody>
  const v = query.data

  return (
    <>
      <PageHeader
        icon={<IconTile><Store /></IconTile>}
        title={v.name}
        description={
          <>
            {VENDOR_CATEGORY_LABEL[v.category]} ·{' '}
            <Link to={PATHS.eventVendors} className="font-medium text-brand-700 hover:underline dark:text-brand-300">All vendors</Link>
          </>
        }
        actions={
          v.canManage && (
            <>
              <Button
                write
                variant="ghost"
                onClick={() => remove.mutate(v.id, { onSuccess: () => { toast.success('Vendor deleted', v.name); navigate(PATHS.eventVendors) }, onError: (err) => toast.error('Not deleted', err.message) })}
              >
                <Trash2 />
                Delete
              </Button>
              <Button write variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            </>
          )
        }
      />
      <PageBody className="space-y-6">
        {v.status === 'blacklisted' && (
          <p role="status" className="rounded-lg bg-danger-50 px-4 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            Blacklisted: this vendor can’t be picked for new budget lines. Lines that already use it keep it.
          </p>
        )}
        <section aria-label="Vendor figures" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <StatCard label="Total spend" icon={<Wallet />} value={moneyIn(v.totalActual, v.currency)} hint={`Planned ${moneyIn(v.totalPlanned, v.currency)}`} />
          <StatCard label="Events worked" icon={<CalendarCheck2 />} value={v.eventCount} hint={v.hiddenEvents ? `${v.hiddenEvents} you can’t see` : 'From budget lines'} />
          <StatCard label="Rating" icon={<Star />} value={v.rating === null ? '—' : v.rating.toFixed(1)} hint={`${v.reviewCount} review${v.reviewCount === 1 ? '' : 's'}`} />
        </section>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Spend per event" icon={<Wallet />} description="Actual amounts of the budget lines linked to this vendor." />
              <table className="w-full text-[0.8125rem]" aria-label="Spend per event">
                <thead className="border-y border-line bg-sunken/50 text-xs text-muted">
                  <tr>
                    <th className="px-5 py-2 text-start font-medium">Event</th>
                    <th className="px-3 py-2 text-end font-medium">Planned</th>
                    <th className="px-3 py-2 text-end font-medium">Actual</th>
                    <th className="px-5 py-2 text-end font-medium">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {v.spend.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-4 text-muted">No budget lines use this vendor yet. Link one from an event’s Budget tab.</td>
                    </tr>
                  )}
                  {v.spend.map((s) => (
                    <tr key={s.eventId}>
                      <td className="px-5 py-2">
                        <Link to={eventPath(s.eventId, 'budget')} className="font-medium text-ink hover:underline">{s.eventName}</Link>
                        <p className="text-xs text-muted">
                          {fmtDate(s.startDate)} · {EVENT_STATUS_LABEL[s.status as EventStatus] ?? s.status} · {s.lines} line{s.lines === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="num px-3 py-2 text-end text-ink-2">{moneyIn(s.planned, v.currency)}</td>
                      <td className="num px-3 py-2 text-end font-medium">{moneyIn(s.actual, v.currency)}</td>
                      <td className="px-5 py-2 text-end">
                        {s.rating !== null ? (
                          <Rating value={s.rating} />
                        ) : s.needsRating && s.canRate ? (
                          <Button write variant="secondary" size="xs" onClick={() => setRating(s)}>
                            <Star />
                            Rate
                          </Button>
                        ) : s.needsRating ? (
                          <Badge tone="amber">Not rated</Badge>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHeader title="Reviews" icon={<Star />} />
              <CardBody>
                {v.reviews.length === 0 ? (
                  <p className="text-[0.8125rem] text-muted">No reviews yet. Completed events with this vendor’s lines ask for one.</p>
                ) : (
                  <ul className="space-y-3" aria-label="Reviews">
                    {v.reviews.map((r) => (
                      <li key={r.id} className="text-[0.8125rem]">
                        <div className="flex items-center gap-2">
                          <Rating value={r.rating} />
                          <span className="font-medium">{r.eventName}</span>
                          <span className="ms-auto text-xs text-muted">{r.ratedByName} · {fmtDate(r.ratedAt.slice(0, 10))}</span>
                        </div>
                        {r.notes && <p className="mt-0.5 text-xs text-muted">{r.notes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <Card className="self-start">
            <CardHeader title="Details" icon={<Store />} action={<VendorStatusBadge status={v.status} />} />
            <CardBody>
              <PropertyList>
                <Property label="Contact">{v.contactName || '—'}</Property>
                <Property label="Mobile">{displayMobile(v.mobile) || '—'}</Property>
                <Property label="Email">{v.email ? <a href={`mailto:${v.email}`} className="hover:underline">{v.email}</a> : '—'}</Property>
                <Property label="Website">
                  {v.website ? (
                    <a href={v.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
                      Open <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    '—'
                  )}
                </Property>
                <Property label="VAT / tax number">{v.taxNumber || '—'}</Property>
                <Property label="Payment terms">{v.paymentTerms || '—'}</Property>
              </PropertyList>
              {v.documents.length > 0 && (
                <ul className="mt-4 space-y-1.5" aria-label="Documents">
                  {v.documents.map((d) => (
                    <li key={d.id}>
                      <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-700 hover:underline dark:text-brand-300">
                        <FileText className="size-3.5" aria-hidden />
                        {d.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {v.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-sunken px-3 py-2 text-xs text-muted">{v.notes}</p>}
            </CardBody>
          </Card>
        </div>
      </PageBody>
      {v.canManage && <VendorDrawer open={editing} onClose={() => setEditing(false)} vendor={v} />}
      {rating && <RateVendorModal vendorId={v.id} vendorName={v.name} eventId={rating.eventId} eventName={rating.eventName} onClose={() => setRating(null)} />}
    </>
  )
}
