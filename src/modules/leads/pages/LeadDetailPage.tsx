import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Ban,
  Building2,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Coins,
  Globe,
  Hash,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trophy,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { LeadStatus, User } from '@/shared/types'
import type { LeadDetail } from '@/modules/leads/types'
import { customerPath, leadEditPath, PATHS, servicePath } from '@/app/paths'

import { LeadQuotations } from '@/modules/quotations/components/LeadQuotations'
import { useLeadQuery, useMoveLeadStage, useSetDoNotContact } from '@/modules/leads/hooks/useLeads'
import { can, scopeOf } from '@/shared/lib/permissions'
import { useLookups, type LookupsApi } from '@/shared/hooks/useLookups'
import type { StatusOption } from '@/modules/settings/types'
import { lossReasonText } from '@/modules/leads/lossReason'
import { useLeadAlerts } from '@/modules/alerts/hooks/useAlerts'
import { LeadAlertBadges } from '@/modules/alerts/components/LeadAlertBadges'
import { cn, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { ApiError } from '@/shared/lib/apiError'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Switch } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { ContactsEditor } from '@/modules/leads/components/ContactsEditor'
import { ActivityLog } from '@/modules/leads/components/ActivityLog'
import { NotesLog } from '@/modules/leads/components/NotesLog'
import { TasksList } from '@/modules/leads/components/TasksList'
import { LogActivityModal } from '@/modules/leads/components/LogActivityModal'
import { FollowUpLabel } from '@/modules/leads/components/FollowUpLabel'
import { requirementFor, StageChangeModal, type PendingMove } from '@/modules/leads/components/StageChangeModal'
import { MessageComposer } from '@/modules/leads/components/MessageComposer'
import { recipientsFor } from '@/modules/leads/components/composer/compose'
import type { MessageChannel } from '@/modules/leads/api/messagesApi'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { CategoryIcon, ServiceChip, UnmatchedChip } from '@/modules/leads/components/ServiceFields'

type Tab = 'overview' | 'activity' | 'notes' | 'tasks' | 'quotations'

export default function LeadDetailPage() {
  const user = useCurrentUser()
  const { id = '' } = useParams()
  if (!user) return null
  if (scopeOf(user.role, 'sales') === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Leads aren’t part of your role" body={`${user.role} has no access to Sales & CRM.`} />
      </PageBody>
    )
  }
  return <LeadRecord id={id} user={user} canEdit={can(user.role, 'sales', 'edit')} />
}

function LeadRecord({ id, user, canEdit }: { id: string; user: User; canEdit: boolean }) {
  const navigate = useNavigate()
  const query = useLeadQuery(id)
  const move = useMoveLeadStage()
  const toast = useToast()
  const lookups = useLookups()
  const leadAlerts = useLeadAlerts()
  const [tab, setTab] = useState<Tab>('overview')
  const [logging, setLogging] = useState(false)
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [composing, setComposing] = useState<MessageChannel | null>(null)

  if (query.isPending) return <DetailSkeleton />
  if (query.isError) {
    const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)
    return (
      <PageBody>
        {notFound ? (
          <EmptyState
            title={query.error.message}
            body="Check the link, or find the lead from the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.leads)}>
                Back to leads
              </Button>
            }
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }

  const lead = query.data

  /** Why a channel can't be used from here, or null when it can. */
  function blockedReason(channel: MessageChannel): string | null {
    if (!canEdit) return 'Your role can view leads but not contact them'
    if (lead.doNotContact) return 'Do Not Contact is on for this lead'
    if (recipientsFor(lead, channel).length === 0) {
      return channel === 'email' ? 'No contact on this lead has an email address' : 'No contact on this lead has a UAE mobile'
    }
    return null
  }
  const outreach = (['email', 'whatsapp'] as const).map((channel) => ({
    channel,
    label: channel === 'email' ? 'Send email' : 'Send WhatsApp',
    icon: channel === 'email' ? <Mail /> : <MessageCircle />,
    blocked: blockedReason(channel),
  }))

  function changeStage(to: LeadStatus) {
    if (to === lead.status) return
    if (requirementFor(lookups.status(to)) === 'none') {
      move.mutate(
        { id: lead.id, status: to },
        {
          onSuccess: () => toast.success(`Moved to ${lookups.statusLabel(to)}`),
          onError: (e) => toast.error('Stage not changed', e.message),
        },
      )
    } else setPending({ lead, to })
  }

  // Spec: Lost / Not interested leads may be reopened after `lostReopenDays` (Settings > Automation).
  const reopenTo = lookups.openStatuses[0]
  function reopen() {
    if (!reopenTo) return
    move.mutate(
      { id: lead.id, status: reopenTo.key },
      {
        onSuccess: () => toast.success(`${lead.company} reopened`, `Back to ${reopenTo.label} with a follow-up tomorrow.`),
        onError: (e) => toast.error('Couldn’t reopen', e.message),
      },
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Record header */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.leads} className="hover:text-ink">
              Leads
            </Link>
            <span className="text-subtle">/</span>
            <span className="text-ink-2">{lead.company}</span>
          </nav>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <Avatar name={lead.company} size="xl" square />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">{lead.company}</h1>
                <StatusBadge status={lead.status} soft />
                <LeadAlertBadges alerts={leadAlerts.get(lead.id)} />
                {lead.doNotContact && (
                  <Badge tone="red" icon={<Ban />}>
                    Do not contact
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <Avatar name={lead.ownerName} size="xs" />
                  {lead.ownerName}
                </span>
                <span>
                  {lookups.industryLabel(lead.industry)}
                  {lead.subIndustry && ` · ${lookups.subIndustryLabel(lead.industry, lead.subIndustry)}`}
                </span>
                <span className="font-mono text-xs">{lead.id}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" disabled title="AI drafting arrives with the AI agent">
                <Sparkles className="text-brand-600" />
                Write with AI
              </Button>
              {/* md and up: one button per channel; tooltips explain why one is unavailable. */}
              {outreach.map((o) =>
                o.blocked ? (
                  <span key={o.channel} className="hidden md:inline-flex">
                    <Tooltip label={o.blocked} side="bottom">
                      <Button variant="secondary" size="sm" disabled aria-label={`${o.label}: ${o.blocked}`}>
                        {o.icon}
                        {o.label}
                      </Button>
                    </Tooltip>
                  </span>
                ) : (
                  <Button key={o.channel} variant="secondary" size="sm" className="hidden md:inline-flex" onClick={() => setComposing(o.channel)}>
                    {o.icon}
                    {o.label}
                  </Button>
                ),
              )}
              {/* Below md: both channels fold into one menu to keep the header on one or two rows. */}
              <div className="md:hidden">
                <Menu
                  align="start"
                  className="w-64"
                  trigger={(props) => (
                    <Button variant="secondary" size="sm" {...props}>
                      <Mail />
                      Contact
                      <ChevronDown />
                    </Button>
                  )}
                >
                  {(close) =>
                    outreach.map((o) =>
                      o.blocked ? (
                        <div
                          key={o.channel}
                          role="menuitem"
                          aria-disabled="true"
                          className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] text-muted [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
                        >
                          {o.icon}
                          <span className="min-w-0">
                            <span className="block">{o.label}</span>
                            <span className="block text-xs text-subtle">{o.blocked}</span>
                          </span>
                        </div>
                      ) : (
                        <MenuItem
                          key={o.channel}
                          icon={o.icon}
                          onSelect={() => {
                            close()
                            setComposing(o.channel)
                          }}
                        >
                          {o.label}
                        </MenuItem>
                      ),
                    )
                  }
                </Menu>
              </div>
              {canEdit && (
                <Button variant="secondary" size="sm" onClick={() => navigate(leadEditPath(lead.id))}>
                  <Pencil />
                  Edit
                </Button>
              )}
              {canEdit && lead.reopenEligible && reopenTo && (
                <Button variant="secondary" size="sm" loading={move.isPending} onClick={reopen}>
                  <RotateCcw />
                  Reopen
                </Button>
              )}
              {canEdit && (
                <StageMenu current={lead.status} statuses={lookups.statuses} onPick={changeStage} />
              )}
              {canEdit && (
                <Button size="sm" onClick={() => setLogging(true)}>
                  <Plus />
                  Log activity
                </Button>
              )}
            </div>
          </div>

          <StageBar status={lead.status} lookups={lookups} canEdit={canEdit} onPick={changeStage} />

          <Tabs<Tab>
            label="Lead sections"
            value={tab}
            onChange={setTab}
            className="mt-4 border-b-0"
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'activity', label: 'Activity' },
              { id: 'notes', label: 'Notes' },
              { id: 'tasks', label: 'Tasks' },
              { id: 'quotations', label: 'Quotations' },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 space-y-6">
            {tab === 'overview' && <Overview lead={lead} lookups={lookups} canEdit={canEdit} onLog={() => setLogging(true)} onSeeAll={() => setTab('activity')} />}
            {tab === 'activity' && (
              <Card>
                <CardHeader title="Activity" description="Every call, email, WhatsApp, visit and meeting on this lead." />
                <CardBody>
                  <ActivityLog leadId={lead.id} canLog={canEdit} onLog={() => setLogging(true)} />
                </CardBody>
              </Card>
            )}
            {tab === 'notes' && (
              <Card>
                <CardHeader title="Notes" description="Each note keeps its author and date." />
                <CardBody>
                  <NotesLog leadId={lead.id} canAdd={canEdit} />
                </CardBody>
              </Card>
            )}
            {tab === 'tasks' && (
              <Card>
                <CardHeader title="Tasks" />
                <CardBody>
                  <TasksList leadId={lead.id} />
                </CardBody>
              </Card>
            )}
            {tab === 'quotations' && <LeadQuotations leadId={lead.id} canEdit={canEdit} />}
          </div>

          <aside className="space-y-4">
            <DetailsCard lead={lead} lookups={lookups} canEdit={canEdit} />
            <ContactsEditor contacts={lead.contacts} />
          </aside>
        </div>
      </PageBody>

      {canEdit && (
        <LogActivityModal
          open={logging}
          onClose={() => setLogging(false)}
          leadId={lead.id}
          doNotContact={lead.doNotContact}
          onLogged={(activity) => {
            setTab('activity')
            if (!activity.autoStatus) toast.success('Activity logged')
          }}
        />
      )}
      {canEdit && !lead.doNotContact && (
        <MessageComposer
          open={composing !== null}
          channel={composing ?? 'email'}
          onClose={() => setComposing(null)}
          lead={lead}
          user={user}
          onSent={() => setTab('activity')}
        />
      )}
      <StageChangeModal
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={(input) => {
          setPending(null)
          move.mutate(input, {
            onSuccess: () => toast.success(`Moved to ${lookups.statusLabel(input.status)}`),
            onError: (e) => toast.error('Stage not changed', e.message),
          })
        }}
      />
    </div>
  )
}

/* ---------------- Stage bar (HubSpot-style deal stages) ---------------- */

/**
 * The main journey, read from the statuses lookup: active open statuses in order that raise the
 * win probability (New → Contacted → Interested → Meeting → Proposal), then the first won status.
 * Open statuses that don't raise it (No response, Call later) are side states shown on the step
 * before them; parked and lost statuses sit beside the bar.
 */
function mainPath(statuses: StatusOption[]): StatusOption[] {
  const path: StatusOption[] = []
  let best = -1
  for (const s of statuses) {
    if (s.kind === 'open' && s.probability > best) {
      path.push(s)
      best = s.probability
    }
  }
  const won = statuses.find((s) => s.kind === 'won')
  return won ? [...path, won] : path
}

function StageBar({
  status,
  lookups,
  canEdit,
  onPick,
}: {
  status: LeadStatus
  lookups: LookupsApi
  canEdit: boolean
  onPick: (s: LeadStatus) => void
}) {
  if (lookups.isLoading) return <Skeleton className="mt-5 h-6 w-full" />
  const current = lookups.status(status)
  const path = mainPath(lookups.statuses)
  const offPath = current.kind === 'lost' || current.kind === 'parked'
  let position = path.findIndex((s) => s.key === status)
  if (position < 0 && current.kind === 'open') {
    // Side state: sits on the last main step ordered before it.
    path.forEach((s, i) => {
      if (s.kind === 'open' && s.order < current.order) position = i
    })
  }
  if (position < 0 && current.kind === 'won') position = path.length - 1

  return (
    <ol aria-label="Pipeline stage" className="mt-5 flex gap-1">
      {path.map((s, i) => {
        const done = !offPath && position >= 0 && i < position
        const here = !offPath && i === position
        return (
          <li key={s.key} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onPick(s.key)}
              aria-current={here ? 'step' : undefined}
              className={cn(
                'group flex w-full flex-col gap-1.5 text-start disabled:cursor-default',
                canEdit && !here && 'cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-full rounded-full transition-colors',
                  offPath
                    ? current.kind === 'lost'
                      ? 'bg-danger-100 dark:bg-danger-500/20'
                      : 'bg-sunken'
                    : done || here
                      ? s.kind === 'won'
                        ? 'bg-success-500'
                        : 'bg-brand-500'
                      : 'bg-sunken group-hover:bg-line-strong',
                )}
              />
              <span
                className={cn(
                  'flex items-center gap-1 truncate text-xs',
                  here ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-subtle',
                )}
              >
                {done && <Check className="size-3 shrink-0 text-brand-600" aria-hidden />}
                {s.label}
                {here && status !== s.key && <span className="font-normal text-muted">· {current.label}</span>}
              </span>
            </button>
          </li>
        )
      })}
      {offPath && (
        <li className="flex shrink-0 items-start ps-2">
          <Badge tone={current.tone}>{current.label}</Badge>
        </li>
      )}
    </ol>
  )
}

function StageMenu({ current, statuses, onPick }: { current: LeadStatus; statuses: StatusOption[]; onPick: (s: LeadStatus) => void }) {
  return (
    <Menu
      className="w-52"
      trigger={(props) => (
        <Button variant="secondary" size="sm" {...props}>
          Change stage
          <ChevronDown />
        </Button>
      )}
    >
      {(close) =>
        statuses.map((s) => (
          <MenuItem
            key={s.key}
            active={s.key === current}
            icon={<span className={cn('m-1 block size-2 rounded-full', DOT[s.tone])} />}
            hint={s.key === current ? <Check className="size-3.5" /> : undefined}
            onSelect={() => {
              close()
              onPick(s.key)
            }}
          >
            {s.label}
          </MenuItem>
        ))
      }
    </Menu>
  )
}

/* ---------------- Overview ---------------- */

function Overview({
  lead,
  lookups,
  canEdit,
  onLog,
  onSeeAll,
}: {
  lead: LeadDetail
  lookups: LookupsApi
  canEdit: boolean
  onLog: () => void
  onSeeAll: () => void
}) {
  const closed = lookups.isClosed(lead.status)
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Highlight icon={<Coins />} label="Estimated value" value={lead.value ? fmtMoney(lead.value) : '—'} />
        <Highlight
          icon={<CalendarClock />}
          label="Next follow-up"
          value={<FollowUpLabel date={lead.nextFollowUpDate} status={lead.status} />}
        />
        <Highlight icon={<CalendarPlus />} label="Added" value={fmtDate(lead.createdAt)} />
      </div>

      {lookups.isWon(lead.status) && lead.customerId && (
        <div className="flex items-center gap-3 rounded-card border border-success-100 bg-success-50 px-4 py-3 text-[0.8125rem] text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-500">
          <Trophy className="size-4 shrink-0" aria-hidden />
          Won and converted to customer{' '}
          <Link to={customerPath(lead.customerId)} className="font-mono font-medium underline">
            {lead.customerId}
          </Link>
          .
        </div>
      )}
      {lead.lossReason && lookups.isLost(lead.status) && (
        <Card>
          <CardHeader
            title="Why it closed"
            description={lead.reopenEligible ? 'Closed long enough ago that it can be reopened.' : undefined}
          />
          <CardBody className="text-[0.8125rem] text-ink-2">{lossReasonText(lookups, lead.lossReason)}</CardBody>
        </Card>
      )}
      {lookups.isParked(lead.status) && (
        <Card>
          <CardHeader title={`Parked as ${lookups.statusLabel(lead.status)}`} />
          <CardBody className="text-[0.8125rem] text-ink-2">
            No automatic follow-ups while the lead is parked. Change the stage to start working it again.
          </CardBody>
        </Card>
      )}
      {lead.nextStep && !closed && (
        <Card>
          <CardHeader title="Next step" description={lead.nextFollowUpDate ? `By ${fmtDate(lead.nextFollowUpDate, 'EEEE d MMM')}` : undefined} />
          <CardBody className="text-[0.8125rem] font-medium">{lead.nextStep}</CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Recent activity"
          action={
            <Button variant="ghost" size="xs" onClick={onSeeAll}>
              See all
            </Button>
          }
        />
        <CardBody>
          <ActivityLog leadId={lead.id} canLog={canEdit} onLog={onLog} limit={4} />
        </CardBody>
      </Card>
    </>
  )
}

function Highlight({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <div className="num mt-1 text-[0.9375rem] font-semibold">{value}</div>
    </div>
  )
}

/* ---------------- Sidebar ---------------- */

function DetailsCard({ lead, lookups, canEdit }: { lead: LeadDetail; lookups: LookupsApi; canEdit: boolean }) {
  const dnc = useSetDoNotContact(lead.id)
  const toast = useToast()
  const checked = dnc.isPending && dnc.variables !== undefined ? dnc.variables : lead.doNotContact
  const catalog = useCatalog()
  const recommended = catalog.byId(lead.recommendedServiceId)

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody className="pb-3">
        <PropertyList>
          <Property label="Company" icon={<Building2 />}>
            {lead.company}
          </Property>
          <Property label="Owner" icon={<UserRound />}>
            <span className="flex items-center gap-1.5">
              <Avatar name={lead.ownerName} size="xs" />
              {lead.ownerName}
            </span>
          </Property>
          <Property label="Stage" icon={<Hash />}>
            <StatusBadge status={lead.status} />
          </Property>
          <Property label="Source" icon={<Globe />}>
            {lookups.sourceLabel(lead.sourceType)}
          </Property>
          <Property label="Source detail" icon={<Link2 />}>
            {lead.sourceDetail || <span className="text-subtle">—</span>}
          </Property>
          <Property label="Industry" icon={<Building2 />}>
            <span className="flex flex-wrap items-center gap-1">
              <Badge>{lookups.industryLabel(lead.industry)}</Badge>
              {lead.subIndustry && <Badge variant="outline">{lookups.subIndustryLabel(lead.industry, lead.subIndustry)}</Badge>}
            </span>
          </Property>
          <Property label="Recommended service" icon={<Sparkles />}>
            {lead.recommendedServiceId ? (
              <Link
                to={servicePath(lead.recommendedServiceId)}
                className="flex max-w-full min-w-0 items-start gap-1.5 font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
              >
                <span className="mt-px shrink-0">
                  <CategoryIcon category={recommended?.category} />
                </span>
                <span className="min-w-0 break-words">{catalog.nameOf(lead.recommendedServiceId)}</span>
                {recommended && !recommended.active && <span className="text-xs font-normal text-subtle">(inactive)</span>}
              </Link>
            ) : lead.recommendedServiceText ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <UnmatchedChip text={lead.recommendedServiceText} />
                {canEdit && (
                  <Link to={leadEditPath(lead.id)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    Match to catalog
                  </Link>
                )}
              </span>
            ) : (
              <span className="text-subtle">—</span>
            )}
          </Property>
          <Property label="Services of interest" icon={<Wrench />}>
            {lead.serviceIds.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {lead.serviceIds.map((sid) => (
                  <ServiceChip key={sid} id={sid} service={catalog.byId(sid)} />
                ))}
              </span>
            ) : (
              <span className="text-subtle">—</span>
            )}
          </Property>
          <Property label="Value" icon={<Coins />}>
            <span className="num">{lead.value ? fmtMoney(lead.value) : '—'}</span>
          </Property>
          <Property label="Do not contact" icon={<Ban />}>
            <Switch
              label="Do not contact"
              checked={checked}
              disabled={!canEdit || dnc.isPending}
              onChange={(v) =>
                dnc.mutate(v, {
                  onSuccess: () => toast.success(v ? 'Marked do not contact' : 'Outreach allowed again'),
                  onError: (e) => toast.error('Not saved', e.message),
                })
              }
            />
          </Property>
        </PropertyList>
      </CardBody>
    </Card>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading lead">
      <div className="border-b border-line px-4 py-5 sm:px-6 lg:px-8">
        <Skeleton className="h-3 w-24" />
        <div className="mt-4 flex gap-4">
          <Skeleton className="size-14 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="mt-6 h-1.5 w-full" />
      </div>
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <Skeleton className="h-80" />
          <Skeleton className="h-72" />
        </div>
      </PageBody>
    </div>
  )
}
