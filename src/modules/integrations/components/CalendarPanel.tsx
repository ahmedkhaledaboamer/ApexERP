import { useState } from 'react'
import { CalendarCheck, CalendarDays, RefreshCw, Unplug } from 'lucide-react'
import type { CalendarProvider, OAuthConsent } from '@/modules/integrations/types'
import { CALENDAR_PROVIDER_LABEL } from '@/modules/integrations/types'
import { integrationsApi, useCalendarConnections, useIntegrationMutation, useIntegrationsAccess, useMyCalendar } from '@/modules/integrations/api'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Switch } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import { Facts, OAuthConsentModal, Section, when } from './shared'

/** The signed-in user's own calendar connection (every role): connect Google / Outlook, two-way sync settings. */
export function MyCalendarCard() {
  const toast = useToast()
  const q = useMyCalendar()
  const [consent, setConsent] = useState<OAuthConsent | null>(null)
  const start = useIntegrationMutation((p: CalendarProvider) => integrationsApi.oauthStart('calendar', p))
  const finish = useIntegrationMutation(integrationsApi.connectCalendar)
  const update = useIntegrationMutation(integrationsApi.updateCalendar)
  const sync = useIntegrationMutation(integrationsApi.syncCalendar)
  const disconnect = useIntegrationMutation(integrationsApi.disconnectCalendar)
  if (q.isPending) return <Skeleton className="h-32" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const c = q.data
  return (
    <div className="space-y-4" data-testid="my-calendar">
      {c.status === 'connected' && c.provider ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green" icon={<CalendarCheck />}>
              Connected
            </Badge>
            <span className="text-[0.8125rem]">
              {CALENDAR_PROVIDER_LABEL[c.provider]} · <span data-testid="calendar-connected-as">{c.connectedAs}</span>
            </span>
          </div>
          <Facts rows={[['Last sync', c.lastSyncAt ? `${when(c.lastSyncAt)} · ${c.pushedCount} item${c.pushedCount === 1 ? '' : 's'} pushed` : 'Not yet']]} />
          <div className="space-y-2">
            {(
              [
                ['pushTasks', 'Push my tasks with a due date to my calendar'],
                ['pushMeetings', 'Push meetings logged on leads'],
                ['showBusy', 'Show my busy times from the calendar'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[0.8125rem]">
                <Switch checked={c.settings[k]} label={label} onChange={(v) => update.mutate({ [k]: v }, { onError: (e) => toast.error('Couldn’t save', e.message) })} />
                {label}
              </label>
            ))}
          </div>
          {c.busy.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Busy in the next 7 days</p>
              <ul className="flex flex-wrap gap-1.5">
                {c.busy.map((b) => (
                  <li key={b.start}>
                    <Badge tone="neutral">
                      {fmtDate(b.start, 'EEE d MMM, HH:mm')}–{fmtDate(b.end, 'HH:mm')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button write size="sm" variant="secondary" loading={sync.isPending} onClick={() => sync.mutate(undefined, { onSuccess: (r) => toast.success('Calendar synced', `${r.pushedCount} item${r.pushedCount === 1 ? '' : 's'} pushed.`), onError: (e) => toast.error('Sync failed', e.message) })}>
              <RefreshCw />
              Sync now
            </Button>
            <Button write size="sm" variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.success('Calendar disconnected'), onError: (e) => toast.error('Couldn’t disconnect', e.message) })}>
              <Unplug />
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-[0.8125rem] text-muted">Connect your own calendar: your tasks show up there and your busy times show up here. Only you can connect it; admins see who’s connected, never your calendar.</p>
          <div className="flex flex-wrap gap-2">
            {(['google', 'outlook'] as CalendarProvider[]).map((p) => (
              <Button key={p} write size="sm" variant="secondary" loading={start.isPending && start.variables === p} onClick={() => start.mutate(p, { onSuccess: setConsent, onError: (e) => toast.error('Couldn’t start sign-in', e.message) })}>
                <CalendarDays />
                Connect {CALENDAR_PROVIDER_LABEL[p]}
              </Button>
            ))}
          </div>
        </div>
      )}
      <OAuthConsentModal
        consent={consent}
        busy={finish.isPending}
        onClose={() => setConsent(null)}
        onDecide={(approve) => {
          if (!consent) return
          finish.mutate(
            { state: consent.state, approve },
            { onSuccess: (r) => toast.success('Calendar connected', r.connectedAs ?? ''), onError: (e) => toast.error(approve ? 'Couldn’t connect' : 'Not connected', e.message), onSettled: () => setConsent(null) },
          )
        }}
      />
    </div>
  )
}

/** Tasks › Calendar toolbar button: opens the user's own calendar sync (plan module `integrations`). */
export function CalendarSyncButton() {
  const { inPlan } = useIntegrationsAccess()
  const [open, setOpen] = useState(false)
  const q = useMyCalendar(inPlan)
  if (!inPlan) return null
  const connected = q.data?.status === 'connected'
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {connected ? <CalendarCheck className="text-success-600" /> : <CalendarDays />}
        {connected ? 'Calendar synced' : 'Connect calendar'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Calendar sync" description="Two-way sync with your Google or Outlook calendar.">
        <MyCalendarCard />
      </Modal>
    </>
  )
}

/** Admin view: the caller's own calendar plus who in the company is connected (no tokens). */
export function CalendarPanel() {
  const q = useCalendarConnections()
  return (
    <div className="space-y-5">
      <Section title="My calendar">
        <MyCalendarCard />
      </Section>
      <Section title="Who’s connected" hint="Each person connects their own calendar from Tasks › Calendar. Tokens stay on the server.">
        {q.isPending ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {(q.data ?? []).map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[0.8125rem]">
                <span className="font-medium">{r.userName}</span>
                <span className="text-xs text-muted">{r.role}</span>
                <Badge tone="neutral" className="ms-auto">
                  {CALENDAR_PROVIDER_LABEL[r.provider]}
                </Badge>
                <span className="text-xs text-muted">{r.connectedAs}</span>
                <span className="text-xs text-muted">synced {when(r.lastSyncAt)}</span>
              </li>
            ))}
            {(q.data ?? []).length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">Nobody has connected a calendar yet.</li>}
          </ul>
        )}
      </Section>
    </div>
  )
}
