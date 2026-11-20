import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Luggage } from 'lucide-react'
import { useLogisticsQuery } from '@/modules/events/hooks/useSponsorsLogistics'
import { DeadlinesPanel, ShipmentsPanel, TripsPanel } from '@/modules/events/components/LogisticsPanels'
import { PATHS } from '@/app/paths'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { SelectInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

type Section = 'trips' | 'shipments' | 'deadlines'
const SECTIONS: Section[] = ['trips', 'shipments', 'deadlines']

/** `/events/logistics`: team trips, shipments and deadlines across the events the company attends or organizes. */
export default function EventLogisticsPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as Section | null
  const section: Section = tabParam && SECTIONS.includes(tabParam) ? tabParam : 'trips'
  const setSection = (s: Section) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (s === 'trips') next.delete('tab')
        else next.set('tab', s)
        return next
      },
      { replace: true },
    )
  const [eventId, setEventId] = useState('')
  const q = useLogisticsQuery(eventId)
  const all = useLogisticsQuery('')
  const b = q.data

  return (
    <>
      <PageHeader
        icon={<IconTile><Luggage /></IconTile>}
        title="Travel & logistics"
        description={
          <>
            Flights, hotels and visas per person, booth shipments and exhibitor deadlines. Trip and shipment costs are posted to each event’s budget.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs<Section>
            label="Logistics sections"
            variant="pill"
            value={section}
            onChange={setSection}
            items={[
              { id: 'trips', label: 'Trips', count: b?.trips.length },
              { id: 'shipments', label: 'Shipments', count: b?.shipments.length },
              { id: 'deadlines', label: 'Deadlines', count: b?.deadlines.filter((d) => !d.done).length },
            ]}
          />
          <SelectInput aria-label="Event" className="ms-auto w-60" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">All events</option>
            {(all.data?.events ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </SelectInput>
        </div>
        <div role="tabpanel" id={`tab-panel-${section}`} aria-labelledby={`tab-${section}`}>
          {q.isPending ? (
            <Skeleton className="h-72 rounded-card" />
          ) : q.error ? (
            <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
          ) : b!.events.length === 0 ? (
            <EmptyState icon={<Luggage />} title="Nothing to organize yet" body="Trips, shipments and deadlines belong to events. You see the events you’re on (or all of them with marketing access) and always your own trips." />
          ) : section === 'trips' ? (
            <TripsPanel bundle={b!} eventId={eventId || undefined} showEvent />
          ) : section === 'shipments' ? (
            <ShipmentsPanel bundle={b!} eventId={eventId || undefined} showEvent />
          ) : (
            <DeadlinesPanel bundle={b!} eventId={eventId || undefined} showEvent />
          )}
        </div>
      </PageBody>
    </>
  )
}
