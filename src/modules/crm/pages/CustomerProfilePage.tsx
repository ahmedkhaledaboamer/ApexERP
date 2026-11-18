import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  BellRing,
  Building2,
  CalendarCheck,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  ExternalLink,
  FilePlus2,
  FileSignature,
  Globe,
  Hash,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trophy,
  UserRound,
  Users,
  Activity as ActivityIcon,
} from 'lucide-react'
import type { Contact } from '@/shared/types'
import type { ContractRow, CustomerDetail, CustomerStatus } from '@/modules/crm/types'
import { leadPath, newQuotationPath, PATHS } from '@/app/paths'
import { crmKeys } from '@/modules/crm/queryKeys'
import { useCustomerQuery, useUpdateCustomer } from '@/modules/crm/hooks/useCrm'
import { BILLING_SUFFIX, contractDisplayStatus, CUSTOMER_STATUSES, CUSTOMER_STATUS_LABEL, CUSTOMER_STATUS_TONE } from '@/modules/crm/constants'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { useLookups } from '@/shared/hooks/useLookups'
import { ContractStatusBadge, CustomerStatusBadge, RenewsIn } from '@/modules/crm/components/CrmBadges'
import { ContactDrawer } from '@/modules/crm/components/ContactDrawer'
import { ContractDrawer } from '@/modules/crm/components/ContractDrawer'
import { CustomerEditDrawer } from '@/modules/crm/components/CustomerEditDrawer'
import { LeadQuotations } from '@/modules/quotations/components/LeadQuotations'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { ServiceChip } from '@/modules/leads/components/ServiceFields'
import { ActivityLog } from '@/modules/leads/components/ActivityLog'
import { NotesLog } from '@/modules/leads/components/NotesLog'
import { LogActivityModal } from '@/modules/leads/components/LogActivityModal'
import { can, scopeOf } from '@/shared/lib/permissions'
import { formatMobile } from '@/shared/lib/phone'
import { getRegion } from '@/shared/lib/region'
import { ApiError } from '@/shared/lib/apiError'
import { cn, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { CustomerTasksPanel } from '@/modules/tasks/components/CustomerTasksPanel'

type Tab = 'overview' | 'activity' | 'contacts' | 'contracts' | 'quotations' | 'tasks' | 'notes'

export default function CustomerProfilePage() {
  const user = useCurrentUser()
  const { id = '' } = useParams()
  if (!user) return null
  if (scopeOf(user.role, 'sales') === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Customers aren’t part of your role" body={`${user.role} has no access to Sales & CRM.`} />
      </PageBody>
    )
  }
  return <CustomerRecord id={id} canEdit={can(user.role, 'sales', 'edit')} />
}

function CustomerRecord({ id, canEdit }: { id: string; canEdit: boolean }) {
  const lookups = useLookups()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const query = useCustomerQuery(id)
  const updateStatus = useUpdateCustomer()
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)
  const [contactDrawer, setContactDrawer] = useState<{ contact: Contact | null } | null>(null)
  const [contractDrawer, setContractDrawer] = useState<{ contract: ContractRow | null } | null>(null)

  if (query.isPending) return <ProfileSkeleton />
  if (query.isError) {
    const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)
    return (
      <PageBody>
        {notFound ? (
          <EmptyState
            title={query.error.message}
            body="Check the link, or find the customer from the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.customers)}>
                Back to customers
              </Button>
            }
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }

  const c = query.data
  const expiring = c.contracts.filter((k) => contractDisplayStatus(k) === 'expiring')
  const record = { type: 'Customer' as const, id: c.id, name: c.name }

  function changeStatus(status: CustomerStatus) {
    if (status === c.status) return
    updateStatus.mutate(
      { id: c.id, input: { status } },
      {
        onSuccess: () => toast.success(`Marked ${CUSTOMER_STATUS_LABEL[status]}`, c.name),
        onError: (e) => toast.error('Status not changed', e.message),
      },
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Record header */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.customers} className="hover:text-ink">
              Customers
            </Link>
            <span className="text-subtle">/</span>
            <span className="truncate text-ink-2">{c.name}</span>
          </nav>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <Avatar name={c.name} size="xl" square />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">{c.name}</h1>
                <CustomerStatusBadge status={c.status} soft />
                {expiring.length > 0 && (
                  <Badge tone="amber" icon={<BellRing />}>
                    Renewal due
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <Avatar name={c.ownerName} size="xs" />
                  {c.ownerName}
                </span>
                <span>
                  {lookups.industryLabel(c.industry)}
                  {c.subIndustry && ` · ${lookups.subIndustryLabel(c.industry, c.subIndustry)}`}
                </span>
                {c.website && <WebsiteLink url={c.website} />}
                <span className="font-mono text-xs">{c.id}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button write variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
              )}
              {canEdit && <StatusMenu current={c.status} onPick={changeStatus} busy={updateStatus.isPending} />}
              {canEdit && (
                <Button write size="sm" onClick={() => navigate(newQuotationPath({ customerId: c.id, leadId: c.leadId }))}>
                  <FilePlus2 />
                  New quotation
                </Button>
              )}
            </div>
          </div>

          <Tabs<Tab>
            label="Customer sections"
            value={tab}
            onChange={setTab}
            className="mt-5 overflow-x-auto border-b-0"
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'activity', label: 'Activity' },
              { id: 'contacts', label: 'Contacts', count: c.contacts.length },
              { id: 'contracts', label: 'Contracts', count: c.contracts.length },
              { id: 'quotations', label: 'Quotations' },
              { id: 'tasks', label: 'Tasks' },
              { id: 'notes', label: 'Notes', count: c.notes.length },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1 space-y-6">
        {expiring.length > 0 && <RenewalBanner contracts={expiring} onOpen={() => setTab('contracts')} />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 space-y-6">
            {tab === 'overview' && (
              <Overview
                customer={c}
                canEdit={canEdit}
                onLog={() => setLogging(true)}
                onSeeAll={() => setTab('activity')}
                onContracts={() => setTab('contracts')}
              />
            )}
            {tab === 'activity' && (
              <Card>
                <CardHeader
                  title="Activity"
                  description="Every call, email, WhatsApp, visit and meeting, from first contact to today."
                  action={
                    canEdit && (
                      <Button write variant="secondary" size="xs" onClick={() => setLogging(true)}>
                        <Plus />
                        Log activity
                      </Button>
                    )
                  }
                />
                <CardBody>
                  <ActivityLog leadId={c.leadId} canLog={canEdit} onLog={() => setLogging(true)} />
                </CardBody>
              </Card>
            )}
            {tab === 'contacts' && (
              <ContactsCard
                contacts={c.contacts}
                canEdit={canEdit}
                onAdd={() => setContactDrawer({ contact: null })}
                onEdit={(contact) => setContactDrawer({ contact })}
              />
            )}
            {tab === 'contracts' && (
              <ContractsCard
                contracts={c.contracts}
                canEdit={canEdit}
                onAdd={() => setContractDrawer({ contract: null })}
                onEdit={(contract) => setContractDrawer({ contract })}
              />
            )}
            {tab === 'quotations' && <LeadQuotations leadId={c.leadId} canEdit={canEdit} />}
            {tab === 'tasks' && (
              <Card>
                <CardHeader title="Tasks" description="Tasks linked to this customer, to the lead it was won from and to its delivery projects." />
                <CardBody>
                  <CustomerTasksPanel customerId={c.id} customerName={c.name} leadId={c.leadId} />
                </CardBody>
              </Card>
            )}
            {tab === 'notes' && (
              <Card>
                <CardHeader title="Notes" description="Notes from the sale and the account since; each keeps its author and date." />
                <CardBody>
                  <NotesLog leadId={c.leadId} canAdd={canEdit} />
                </CardBody>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <DetailsCard customer={c} />
            <KeyContacts contacts={c.contacts} onAll={() => setTab('contacts')} />
          </aside>
        </div>
      </PageBody>

      {canEdit && (
        <>
          <CustomerEditDrawer open={editing} onClose={() => setEditing(false)} customer={c} />
          <ContactDrawer
            open={!!contactDrawer}
            onClose={() => setContactDrawer(null)}
            contact={contactDrawer?.contact}
            record={record}
          />
          <ContractDrawer
            open={!!contractDrawer}
            onClose={() => setContractDrawer(null)}
            contract={contractDrawer?.contract}
            customer={{ id: c.id, name: c.name }}
          />
          <LogActivityModal
            open={logging}
            onClose={() => setLogging(false)}
            leadId={c.leadId}
            doNotContact={c.lead.doNotContact}
            onLogged={() => {
              qc.invalidateQueries({ queryKey: crmKeys.all })
              setTab('activity')
              toast.success('Activity logged')
            }}
          />
        </>
      )}
    </div>
  )
}

/* ---------------- Header bits ---------------- */

function WebsiteLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-w-0 items-center gap-1 text-accent-700 hover:underline dark:text-accent-300"
    >
      <Globe className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
    </a>
  )
}

function StatusMenu({ current, onPick, busy }: { current: CustomerStatus; onPick: (s: CustomerStatus) => void; busy: boolean }) {
  return (
    <Menu
      className="w-44"
      trigger={(props) => (
        <Button write variant="secondary" size="sm" loading={busy} {...props}>
          Status
          <ChevronDown />
        </Button>
      )}
    >
      {(close) =>
        CUSTOMER_STATUSES.map((s) => (
          <MenuItem
            key={s}
            active={s === current}
            icon={<span className={cn('m-1 block size-2 rounded-full', DOT[CUSTOMER_STATUS_TONE[s]])} />}
            hint={s === current ? <Check className="size-3.5" /> : undefined}
            onSelect={() => {
              close()
              onPick(s)
            }}
          >
            {CUSTOMER_STATUS_LABEL[s]}
          </MenuItem>
        ))
      }
    </Menu>
  )
}

/** Spec: "Alert 30 days before the renewal date" (the window is set in Settings > Automation). */
function RenewalBanner({ contracts, onOpen }: { contracts: ContractRow[]; onOpen: () => void }) {
  const { rules } = useAutomationRules()
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-card border border-warning-100 bg-warning-50 px-4 py-3 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500"
    >
      <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {contracts.length === 1 ? 'A contract renews' : `${contracts.length} contracts renew`} within {rules.renewalAlertDays} days
        </p>
        <ul className="mt-1 space-y-0.5">
          {contracts.map((k) => (
            <li key={k.id}>
              <span className="font-medium">{k.title}</span> — <RenewsIn days={k.daysToRenewal} className="text-inherit" /> on{' '}
              <span className="num">{fmtDate(k.renewalDate)}</span>,{' '}
              <span className="num">
                {fmtMoney(k.value)}
                {BILLING_SUFFIX[k.billing]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button variant="secondary" size="xs" onClick={onOpen}>
        Review contracts
      </Button>
    </div>
  )
}

/* ---------------- Overview ---------------- */

function Overview({
  customer: c,
  canEdit,
  onLog,
  onSeeAll,
  onContracts,
}: {
  customer: CustomerDetail
  canEdit: boolean
  onLog: () => void
  onSeeAll: () => void
  onContracts: () => void
}) {
  const catalog = useCatalog()
  // Catalog ids from live and past contracts; names and icons come from the catalog (inactive still resolve).
  const purchased = [...new Set(c.contracts.filter((k) => k.status !== 'cancelled').flatMap((k) => k.serviceIds))]
  const decisionMakers = c.contacts.filter((x) => x.isDecisionMaker).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Highlight icon={<CircleDollarSign />} label="Lifetime value" value={fmtMoney(c.lifetimeValue)} />
        <Highlight
          icon={<FileSignature />}
          label="Active contracts"
          value={c.activeContracts}
          sub={c.activeContracts ? `${fmtMoney(c.activeContractValue)} / yr` : 'None live'}
        />
        <Highlight icon={<Users />} label="Contacts" value={c.contacts.length} sub={`${decisionMakers} decision maker${decisionMakers === 1 ? '' : 's'}`} />
        <Highlight
          icon={<ActivityIcon />}
          label="Last activity"
          value={c.lastActivityAt ? formatDistanceToNowStrict(new Date(c.lastActivityAt), { addSuffix: true }) : '—'}
          sub={c.lastActivityAt ? fmtDate(c.lastActivityAt) : 'Nothing logged yet'}
        />
      </div>

      <div className="flex items-center gap-3 rounded-card border border-success-100 bg-success-50 px-4 py-3 text-[0.8125rem] text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-500">
        <Trophy className="size-4 shrink-0" aria-hidden />
        <span>
          Won on <span className="num font-medium">{fmtDate(c.wonAt)}</span> for <span className="num font-medium">{fmtMoney(c.wonValue)}</span> from lead{' '}
          <Link to={leadPath(c.leadId)} className="font-mono font-medium underline">
            {c.leadId}
          </Link>
          . Contacts, activity and notes came across with it.
        </span>
      </div>

      <Card>
        <CardHeader
          title="Purchased services"
          description={purchased.length ? 'From live and past contracts' : 'Discussed during the sale; no contract recorded yet'}
          action={
            <Button variant="ghost" size="xs" onClick={onContracts}>
              Contracts
            </Button>
          }
        />
        <CardBody className="flex flex-wrap gap-1.5">
          {purchased.length
            ? purchased.map((sid) => <ServiceChip key={sid} id={sid} service={catalog.byId(sid)} />)
            : c.serviceIds.length
              ? c.serviceIds.map((sid) => <ServiceChip key={sid} id={sid} service={catalog.byId(sid)} />)
              : <span className="text-[0.8125rem] text-muted">Nothing recorded yet.</span>}

        </CardBody>
      </Card>

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
          <ActivityLog leadId={c.leadId} canLog={canEdit} onLog={onLog} limit={5} />
        </CardBody>
      </Card>
    </>
  )
}

function Highlight({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface px-4 py-3 shadow-xs">
      <p className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <div className="num mt-1 truncate text-[1.0625rem] font-semibold">{value}</div>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  )
}

/* ---------------- Contacts ---------------- */

function ContactsCard({
  contacts,
  canEdit,
  onAdd,
  onEdit,
}: {
  contacts: Contact[]
  canEdit: boolean
  onAdd: () => void
  onEdit: (c: Contact) => void
}) {
  return (
    <Card>
      <CardHeader
        title="Contacts"
        description="People at this company. Decision makers are marked with a star."
        action={
          canEdit && (
            <Button write variant="secondary" size="xs" onClick={onAdd}>
              <Plus />
              Add contact
            </Button>
          )
        }
      />
      {contacts.length === 0 ? (
        <EmptyState title="No contacts yet" body="Add the people you work with at this company." icon={<Users />} />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {[...contacts]
            .sort((a, b) => Number(b.isDecisionMaker) - Number(a.isDecisionMaker))
            .map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={p.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
                    <span className="truncate">{p.name}</span>
                    {p.isDecisionMaker && (
                      <Badge tone="amber" icon={<Star />}>
                        Decision maker
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">{p.title || 'No title'}</p>
                </div>
                <div className="flex min-w-0 flex-col items-start gap-0.5 text-xs sm:items-end">
                  {p.mobile && (
                    <a href={`tel:${p.mobile.replace(/\s/g, '')}`} className="num text-ink-2 hover:text-ink">
                      {formatMobile(p.mobile, getRegion().country)}
                    </a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} className="max-w-56 truncate text-accent-700 hover:underline dark:text-accent-300">
                      {p.email}
                    </a>
                  )}
                </div>
                {canEdit && (
                  <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)}>
                    <Pencil />
                  </Button>
                )}
              </li>
            ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Contracts ---------------- */

function ContractsCard({
  contracts,
  canEdit,
  onAdd,
  onEdit,
}: {
  contracts: ContractRow[]
  canEdit: boolean
  onAdd: () => void
  onEdit: (c: ContractRow) => void
}) {
  return (
    <Card>
      <CardHeader
        title="Contracts"
        description="What the customer signed, how it bills and when it renews."
        action={
          canEdit && (
            <Button write variant="secondary" size="xs" onClick={onAdd}>
              <Plus />
              New contract
            </Button>
          )
        }
      />
      {contracts.length === 0 ? (
        <EmptyState title="No contracts yet" body="Record the signed scope to track renewals and recurring revenue." icon={<FileSignature />} />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {contracts.map((k) => (
            <li key={k.id} className={cn('flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5', k.status === 'cancelled' && 'opacity-70')}>
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium">
                  <span className="truncate">{k.title}</span>
                  <ContractStatusBadge status={contractDisplayStatus(k)} />
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {k.serviceNames.map((s) => (
                    <Badge key={s} variant="outline">
                      {s}
                    </Badge>
                  ))}
                </p>
                <p className="num mt-1 text-xs text-muted">
                  {k.id} · {k.billing} · started {fmtDate(k.startDate)}
                </p>
              </div>
              <div className="text-end">
                <p className="num text-[0.8125rem] font-semibold">
                  {fmtMoney(k.value)}
                  <span className="font-normal text-muted">{BILLING_SUFFIX[k.billing]}</span>
                </p>
                <p className="mt-0.5 text-xs">
                  <span className="text-muted">Renews </span>
                  <RenewsIn days={k.daysToRenewal} cancelled={k.status === 'cancelled'} />
                </p>
                <p className="num text-xs text-muted">{fmtDate(k.renewalDate)}</p>
              </div>
              {canEdit && (
                <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${k.title}`} onClick={() => onEdit(k)}>
                  <Pencil />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Sidebar ---------------- */

function DetailsCard({ customer: c }: { customer: CustomerDetail }) {
  const lookups = useLookups()
  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody className="pb-3">
        <PropertyList>
          <Property label="Status" icon={<Hash />}>
            <CustomerStatusBadge status={c.status} />
          </Property>
          <Property label="Owner" icon={<UserRound />}>
            <span className="flex items-center gap-1.5">
              <Avatar name={c.ownerName} size="xs" />
              {c.ownerName}
            </span>
          </Property>
          <Property label="Industry" icon={<Building2 />}>
            <span className="flex flex-wrap items-center gap-1">
              <Badge>{lookups.industryLabel(c.industry)}</Badge>
              {c.subIndustry && <Badge variant="outline">{lookups.subIndustryLabel(c.industry, c.subIndustry)}</Badge>}
            </span>
          </Property>
          <Property label="Website" icon={<Globe />}>
            {c.website ? <WebsiteLink url={c.website} /> : <span className="text-muted">—</span>}
          </Property>
          {(getRegion().country === 'AE' || !!c.emirate) && (
            <Property label="Emirate" icon={<MapPin />}>
              {c.emirate || <span className="text-muted">—</span>}
            </Property>
          )}
          <Property label="Address" icon={<MapPin />}>
            {c.address ? <span className="break-words">{c.address}</span> : <span className="text-muted">Not set</span>}
          </Property>
          <Property label="Customer since" icon={<CalendarCheck />}>
            <span className="num">{fmtDate(c.createdAt)}</span>
          </Property>
          <Property label="Won value" icon={<Coins />}>
            <span className="num">{fmtMoney(c.wonValue)}</span>
          </Property>
          <Property label="Source" icon={<Globe />}>
            {lookups.sourceLabel(c.lead.sourceType)}
            {c.lead.sourceDetail && <span className="block text-xs text-muted">{c.lead.sourceDetail}</span>}
          </Property>
          <Property label="Original lead" icon={<Hash />}>
            <Link to={leadPath(c.leadId)} className="font-mono text-xs text-accent-700 hover:underline dark:text-accent-300">
              {c.leadId}
            </Link>
          </Property>
        </PropertyList>
      </CardBody>
    </Card>
  )
}

function KeyContacts({ contacts, onAll }: { contacts: Contact[]; onAll: () => void }) {
  const key = [...contacts].sort((a, b) => Number(b.isDecisionMaker) - Number(a.isDecisionMaker)).slice(0, 3)
  return (
    <Card>
      <CardHeader
        title="Key contacts"
        action={
          contacts.length > 0 && (
            <Button variant="ghost" size="xs" onClick={onAll}>
              All {contacts.length}
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {key.length === 0 && <p className="text-[0.8125rem] text-muted">No contacts yet.</p>}
        {key.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5">
            <Avatar name={p.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-[0.8125rem] font-medium">
                {p.name}
                {p.isDecisionMaker && <Star className="size-3 shrink-0 fill-warning-500 text-warning-500" aria-label="Decision maker" />}
              </p>
              <p className="truncate text-xs text-muted">{p.title || p.email}</p>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading customer">
      <div className="border-b border-line px-4 py-5 sm:px-6 lg:px-10">
        <Skeleton className="h-3 w-24" />
        <div className="mt-4 flex gap-4">
          <Skeleton className="size-14 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="mt-6 h-6 w-80" />
      </div>
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
          <Skeleton className="h-96" />
        </div>
      </PageBody>
    </div>
  )
}
