import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, Plus, Ticket } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Segmented } from '@/shared/components/ui/Segmented'
import { IconTile, PageHeader } from '@/shared/components/layout/PageHeader'
import { EventDrawer } from './EventDrawer'

type View = 'list' | 'calendar'

/** Header shared by the events list and calendar: the view switch and "New event" (marketing create right). */
export function EventsFrame({ description, children }: { description: ReactNode; children: ReactNode }) {
  const user = useCurrentUser()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const view: View = pathname.startsWith(PATHS.eventCalendar) ? 'calendar' : 'list'
  const canCreate = !!user && can(user.role, 'marketing', 'create')
  return (
    <>
      <PageHeader
        icon={<IconTile>{view === 'calendar' ? <CalendarDays /> : <Ticket />}</IconTile>}
        title={view === 'calendar' ? 'Events calendar' : 'Events'}
        description={description}
        actions={
          <>
            <Segmented<View>
              label="Events view"
              size="sm"
              value={view}
              onChange={(v) => navigate(v === 'calendar' ? PATHS.eventCalendar : PATHS.events)}
              options={[
                { value: 'list', label: 'List' },
                { value: 'calendar', label: 'Calendar' },
              ]}
            />
            {canCreate && (
              <Button write onClick={() => setCreating(true)}>
                <Plus />
                New event
              </Button>
            )}
          </>
        }
      />
      {children}
      {canCreate && <EventDrawer open={creating} onClose={() => setCreating(false)} event={null} />}
    </>
  )
}
