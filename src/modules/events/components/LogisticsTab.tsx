import { useState } from 'react'
import { CalendarClock, Plane, Truck } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import { useLogisticsQuery } from '@/modules/events/hooks/useSponsorsLogistics'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { DeadlinesPanel, ShipmentsPanel, TripsPanel } from '@/modules/events/components/LogisticsPanels'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'

type Section = 'trips' | 'shipments' | 'deadlines'

/** The event's "Logistics" tab: trips, shipments and deadlines; trip and shipment costs are on the Budget tab too. */
export function LogisticsTab({ event: e }: { event: EventDetail }) {
  const q = useLogisticsQuery(e.id, true)
  const [section, setSection] = useState<Section>('trips')
  if (q.isPending) return <Skeleton className="h-64 rounded-card" />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const b = q.data
  const travel = b.trips.reduce((s, t) => s + t.total, 0)
  const freight = b.shipments.reduce((s, x) => s + x.cost, 0)
  const open = b.deadlines.filter((d) => !d.done)
  return (
    <div className="space-y-6">
      <section aria-label="Logistics totals" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard label="Travel" icon={<Plane />} value={moneyIn(travel, b.currency)} hint={`${b.trips.length} trip${b.trips.length === 1 ? '' : 's'} · on the budget as travel`} />
        <StatCard label="Shipping" icon={<Truck />} value={moneyIn(freight, b.currency)} hint={`${b.shipments.length} shipment${b.shipments.length === 1 ? '' : 's'} · on the budget as logistics`} />
        <StatCard label="Open deadlines" icon={<CalendarClock />} value={open.length} hint={open.some((d) => d.overdue) ? `${open.filter((d) => d.overdue).length} overdue` : 'None overdue'} />
      </section>
      <Tabs<Section>
        label="Logistics sections"
        variant="pill"
        value={section}
        onChange={setSection}
        items={[
          { id: 'trips', label: 'Trips', count: b.trips.length },
          { id: 'shipments', label: 'Shipments', count: b.shipments.length },
          { id: 'deadlines', label: 'Deadlines', count: open.length },
        ]}
      />
      <div role="tabpanel" id={`tab-panel-${section}`} aria-labelledby={`tab-${section}`}>
        {section === 'trips' && <TripsPanel bundle={b} eventId={e.id} showEvent={false} />}
        {section === 'shipments' && <ShipmentsPanel bundle={b} eventId={e.id} showEvent={false} />}
        {section === 'deadlines' && <DeadlinesPanel bundle={b} eventId={e.id} showEvent={false} />}
      </div>
    </div>
  )
}
