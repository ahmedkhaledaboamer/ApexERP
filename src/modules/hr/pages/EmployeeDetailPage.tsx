import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Briefcase, CheckCircle2, Circle, FileSignature, FileText, History, Laptop, LogOut, Pencil, Plus, RefreshCcw, Trash2, UserRound } from 'lucide-react'
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import type { AssetRow, EmployeeContract, EmployeeDetail, EmployeeDocument } from '@/modules/hr/peopleTypes'
import { CONTRACT_TYPE_LABEL, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { useAssetsQuery, useCompleteOffboarding, useDeleteDocument, useEmployeeQuery, useLinkUser, useUnlinkedUsersQuery } from '@/modules/hr/hooks/useHrPeople'
import { revealDocument, revealIban } from '@/modules/hr/api/hrPeopleApi'
import { useCreateUser, useDeactivateUser } from '@/modules/settings/hooks/useSettingsUsers'
import { ContractStatusBadge, DocumentStatusBadge, EmploymentStatusBadge, FileLink, HrError, MaskedValue, Money } from '@/modules/hr/components/PeopleBits'
import { EmployeeDrawer } from '@/modules/hr/components/EmployeeDrawer'
import { DocumentModal } from '@/modules/hr/components/DocumentModal'
import { ContractDrawer } from '@/modules/hr/components/ContractDrawer'
import { AssetActions, AssetDetailDrawer, AssignModal, LostModal, ReturnModal } from '@/modules/hr/components/AssetComponents'
import { employeePath, PATHS } from '@/app/paths'
import { can } from '@/shared/lib/permissions'
import { fmtDate } from '@/shared/lib/utils'
import { countryLabel } from '@/shared/lib/country'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

type Tab = 'overview' | 'documents' | 'contract' | 'assets' | 'activity'
const TABS: Tab[] = ['overview', 'documents', 'contract', 'assets', 'activity']

/** `/hr/employees/:id`: the employee profile (Overview, Documents, Contract, Assets, Activity). */
export default function EmployeeDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const query = useEmployeeQuery(id)
  const [editing, setEditing] = useState(false)
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'overview'

  if (query.isPending) return <PageBody><Skeleton className="h-64 rounded-card" /></PageBody>
  if (query.error) return <PageBody><HrError error={query.error} onRetry={() => query.refetch()} /></PageBody>
  const e = query.data
  const alerts = e.documents.filter((d) => d.status !== 'valid').length

  return (
    <>
      <PageHeader
        icon={<Avatar name={e.fullName} />}
        title={e.fullName}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num">{e.employeeNo}</span>·<span>{e.jobTitle}</span>
            {e.departmentName && <>·<span>{e.departmentName}</span></>}
            <EmploymentStatusBadge status={e.status} />
            {e.access !== 'own' && <Link to={PATHS.hrEmployees} className="font-medium text-brand-700 hover:underline dark:text-brand-300">All employees</Link>}
          </span>
        }
        actions={
          e.canManage && (
            <Button write variant="secondary" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )
        }
      />
      <PageBody className="space-y-6">
        <Tabs<Tab>
          label="Employee sections"
          value={tab}
          onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}
          items={[
            { id: 'overview', label: 'Overview', icon: <UserRound /> },
            { id: 'documents', label: 'Documents', icon: <FileText />, count: alerts || undefined },
            { id: 'contract', label: 'Contract', icon: <FileSignature /> },
            { id: 'assets', label: 'Assets', icon: <Laptop />, count: e.assets.length || undefined },
            { id: 'activity', label: 'Activity', icon: <History /> },
          ]}
        />
        <div id={`tab-panel-${tab}`} role="tabpanel">
          {tab === 'overview' && <Overview e={e} />}
          {tab === 'documents' && <DocumentsTab e={e} />}
          {tab === 'contract' && <ContractTab e={e} />}
          {tab === 'assets' && <AssetsTab e={e} />}
          {tab === 'activity' && <ActivityTab e={e} />}
        </div>
      </PageBody>
      {e.canManage && <EmployeeDrawer open={editing} onClose={() => setEditing(false)} employee={e} />}
    </>
  )
}

/* ---------------- overview ---------------- */

function Overview({ e }: { e: EmployeeDetail }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        {e.offboarding && <OffboardingCard e={e} />}
        <Card>
          <CardHeader title="Job" icon={<Briefcase />} />
          <CardBody>
            <PropertyList>
              <Property label="Employee no.">{e.employeeNo}</Property>
              <Property label="Job title">{e.jobTitle}</Property>
              <Property label="Department">{e.departmentName ?? '—'}</Property>
              <Property label="Manager">{e.managerId && e.managerName ? <Link className="hover:underline" to={employeePath(e.managerId)}>{e.managerName}</Link> : '—'}</Property>
              <Property label="Hire date">{fmtDate(e.hireDate)}</Property>
              <Property label="Type">{EMPLOYMENT_TYPE_LABEL[e.employmentType]}</Property>
              {e.exitDate && <Property label="Exit date">{fmtDate(e.exitDate)}</Property>}
            </PropertyList>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Personal" icon={<UserRound />} />
          <CardBody>
            <PropertyList>
              <Property label="Email">{e.email || '—'}</Property>
              <Property label="Mobile">{e.mobile || '—'}</Property>
              <Property label="Nationality">{countryLabel(e.nationality)}</Property>
              <Property label="Date of birth">{fmtDate(e.dateOfBirth) || '—'}</Property>
              <Property label="Emergency contact">{e.emergencyContact.name ? `${e.emergencyContact.name} (${e.emergencyContact.relation || '—'}) · ${e.emergencyContact.phone || '—'}` : '—'}</Property>
              <Property label="Address">{[e.address.line1, e.address.city, e.address.country].filter(Boolean).join(', ') || '—'}</Property>
            </PropertyList>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <LoginCard e={e} />
        {e.bank && (
          <Card>
            <CardHeader title="Bank details" />
            <CardBody>
              <PropertyList>
                <Property label="Bank">{e.bank.bankName || '—'}</Property>
                <Property label="Account name">{e.bank.accountName || '—'}</Property>
                <Property label="IBAN">
                  <MaskedValue masked={e.bank.ibanMasked} canReveal={e.canManage} reveal={() => revealIban(e.id)} label="IBAN" />
                </Property>
              </PropertyList>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

function LoginCard({ e }: { e: EmployeeDetail }) {
  const me = useCurrentUser()
  const toast = useToast()
  const link = useLinkUser()
  const create = useCreateUser()
  const unlinked = useUnlinkedUsersQuery(e.canManage && !e.linkedUser)
  const [pick, setPick] = useState('')
  const settingsEdit = !!me && can(me.role, 'settings', 'edit')
  const settingsView = !!me && can(me.role, 'settings', 'view')

  async function invite() {
    if (!e.email || !e.mobile || !e.departmentId) {
      toast.error('Can’t invite yet', 'A login needs the employee’s email, mobile and department. Edit the employee first.')
      return
    }
    try {
      const u = await create.mutateAsync({ name: e.fullName, email: e.email, mobile: e.mobile, role: 'Employee', title: e.jobTitle, departmentId: e.departmentId, managerId: null })
      await link.mutateAsync({ id: e.id, userId: u.id })
      toast.success('Invited as a user', `${u.email} can now sign in (role Employee).`)
    } catch (err) {
      toast.error('Not invited', err instanceof Error ? err.message : 'Try again.')
    }
  }

  return (
    <Card>
      <CardHeader title="Login" icon={<UserRound />} />
      <CardBody className="space-y-3 text-[0.8125rem]">
        {e.linkedUser ? (
          <>
            <p>
              <span className="font-medium text-ink">{e.linkedUser.name}</span> · {e.linkedUser.email}
            </p>
            <p className="flex items-center gap-2">
              <Badge tone={e.linkedUser.active ? 'green' : 'neutral'}>{e.linkedUser.active ? 'Active' : 'Deactivated'}</Badge>
              <span className="text-muted">{e.linkedUser.role}</span>
            </p>
            {settingsView && <Link to="/settings/users" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Open in Settings › Users</Link>}
          </>
        ) : (
          <>
            <p className="text-muted">No system login. Employee records don’t need one.</p>
            {e.canManage && (
              <div className="flex gap-2">
                <SelectInput aria-label="User to link" value={pick} onChange={(x) => setPick(x.target.value)}>
                  <option value="">Link an existing user…</option>
                  {(unlinked.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
                  ))}
                </SelectInput>
                <Button write variant="secondary" disabled={!pick} loading={link.isPending} onClick={() => link.mutate({ id: e.id, userId: pick }, { onSuccess: () => toast.success('User linked'), onError: (x) => toast.error('Not linked', x.message) })}>
                  Link
                </Button>
              </div>
            )}
            {e.canManage && settingsEdit && (
              <Button write variant="secondary" size="sm" loading={create.isPending} onClick={invite}>
                <Plus />
                Invite as user
              </Button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

function OffboardingCard({ e }: { e: EmployeeDetail }) {
  const me = useCurrentUser()
  const toast = useToast()
  const complete = useCompleteOffboarding()
  const deactivate = useDeactivateUser()
  const o = e.offboarding!
  const settingsEdit = !!me && can(me.role, 'settings', 'edit')
  return (
    <Card>
      <CardHeader
        title={o.completedAt ? 'Offboarding completed' : 'Offboarding'}
        icon={<LogOut />}
        description={o.completedAt ? `Completed ${fmtDate(o.completedAt.slice(0, 10))}` : `Started ${fmtDate(o.startedAt.slice(0, 10))}${e.exitDate ? ` · last day ${fmtDate(e.exitDate)}` : ''}`}
        action={
          e.canManage && !o.completedAt && (
            <Button write size="sm" disabled={!o.canComplete} loading={complete.isPending} onClick={() => complete.mutate(e.id, { onSuccess: () => toast.success('Offboarding completed'), onError: (x) => toast.error('Not completed', x.message) })}>
              Complete offboarding
            </Button>
          )
        }
      />
      <CardBody>
        <ul className="space-y-2.5" aria-label="Offboarding checklist">
          {o.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-[0.8125rem]">
              {s.done ? <CheckCircle2 className="mt-0.5 size-4 text-success-600" aria-label="Done" /> : <Circle className="mt-0.5 size-4 text-muted" aria-label="To do" />}
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{s.label}</span>
                {s.blocking && !s.done && <Badge tone="amber" className="ms-2">Required</Badge>}
                <span className="block text-xs text-muted">{s.detail}</span>
              </span>
              {s.key === 'login' && !s.done && e.linkedUser && settingsEdit && (
                <Button
                  write
                  variant="secondary"
                  size="sm"
                  loading={deactivate.isPending}
                  onClick={() => deactivate.mutate({ id: e.linkedUser!.id, confirm: true }, { onSuccess: () => toast.success('Login deactivated', e.linkedUser!.email), onError: (x) => toast.error('Not deactivated', x.message) })}
                >
                  Deactivate login
                </Button>
              )}
            </li>
          ))}
        </ul>
        {o.steps.some((s) => s.key === 'login' && !s.done) && !settingsEdit && <p className="mt-3 text-xs text-muted">A Company Admin deactivates the login in Settings › Users.</p>}
      </CardBody>
    </Card>
  )
}

/* ---------------- documents ---------------- */

function DocumentsTab({ e }: { e: EmployeeDetail }) {
  const [editing, setEditing] = useState<EmployeeDocument | 'new' | null>(null)
  const remove = useDeleteDocument()
  const toast = useToast()
  return (
    <Card>
      <CardHeader
        title="Documents"
        icon={<FileText />}
        description="Numbers are masked (last 4). Alerts go to HR and the manager 60 days before expiry and on expiry."
        action={e.canManage && <Button write size="sm" onClick={() => setEditing('new')}><Plus />Add document</Button>}
      />
      {e.documents.length === 0 ? (
        <CardBody><p className="text-[0.8125rem] text-muted">No documents yet.</p></CardBody>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Documents">
            <thead className="text-start text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 text-start font-medium">Type</th>
                <th className="px-3 py-2 text-start font-medium">Number</th>
                <th className="px-3 py-2 text-start font-medium">Issued</th>
                <th className="px-3 py-2 text-start font-medium">Expires</th>
                <th className="px-3 py-2 text-start font-medium">Country</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-start font-medium">File</th>
                {e.canManage && <th className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {e.documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-2.5 font-medium text-ink">{DOCUMENT_TYPE_LABEL[d.type]}</td>
                  <td className="px-3 py-2.5"><MaskedValue masked={d.numberMasked} canReveal={e.canManage} reveal={() => revealDocument(d.id)} label={`${DOCUMENT_TYPE_LABEL[d.type]} number`} /></td>
                  <td className="num px-3 py-2.5">{fmtDate(d.issueDate) || '—'}</td>
                  <td className="num px-3 py-2.5">{fmtDate(d.expiryDate) || '—'}</td>
                  <td className="px-3 py-2.5">{d.issuingCountry || '—'}</td>
                  <td className="px-3 py-2.5"><DocumentStatusBadge status={d.status} days={d.daysToExpiry} /></td>
                  <td className="max-w-48 px-3 py-2.5"><FileLink file={d.file} /></td>
                  {e.canManage && (
                    <td className="px-5 py-2.5">
                      <span className="flex justify-end gap-1">
                        <Button write variant="ghost" size="sm" aria-label={`Edit ${DOCUMENT_TYPE_LABEL[d.type]}`} onClick={() => setEditing(d)}><Pencil /></Button>
                        <Button write variant="ghost" size="sm" aria-label={`Delete ${DOCUMENT_TYPE_LABEL[d.type]}`} onClick={() => remove.mutate(d.id, { onSuccess: () => toast.success('Document deleted'), onError: (x) => toast.error('Not deleted', x.message) })}><Trash2 /></Button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DocumentModal employeeId={e.id} doc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

/* ---------------- contract ---------------- */

function ContractTab({ e }: { e: EmployeeDetail }) {
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit' | 'renew'; contract: EmployeeContract | null } | null>(null)
  const active = e.contracts.find((c) => c.status === 'active')
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Contracts"
          icon={<FileSignature />}
          description="One active contract at a time; renewals keep the history."
          action={e.canManage && !active && <Button write size="sm" onClick={() => setDrawer({ mode: 'create', contract: null })}><Plus />New contract</Button>}
        />
        {e.contracts.length === 0 ? (
          <CardBody><p className="text-[0.8125rem] text-muted">No contract on file.</p></CardBody>
        ) : (
          <ul className="divide-y divide-line" aria-label="Contracts">
            {e.contracts.map((c) => (
              <li key={c.id} className="px-5 py-3.5 text-[0.8125rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{CONTRACT_TYPE_LABEL[c.type]}</span>
                  <ContractStatusBadge status={c.status} />
                  {c.inProbation && <Badge tone="sky">In probation until {fmtDate(c.probationEndDate)}</Badge>}
                  {c.daysToEnd !== null && c.daysToEnd <= 60 && <Badge tone="amber">Ends in {c.daysToEnd} days</Badge>}
                  <span className="num text-muted">{fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : 'open-ended'}</span>
                  {e.canManage && (c.status === 'active' || c.status === 'ended') && (
                    <span className="ms-auto flex gap-1">
                      {c.status === 'active' && <Button write variant="ghost" size="sm" onClick={() => setDrawer({ mode: 'edit', contract: c })}><Pencil />Edit</Button>}
                      <Button write variant="secondary" size="sm" onClick={() => setDrawer({ mode: 'renew', contract: c })}><RefreshCcw />Renew</Button>
                    </span>
                  )}
                  {e.canManage && c.status === 'draft' && <Button write variant="ghost" size="sm" className="ms-auto" onClick={() => setDrawer({ mode: 'edit', contract: c })}><Pencil />Edit</Button>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  <div><dt className="text-muted">Basic</dt><dd><Money value={c.basicSalary} currency={c.currency} /></dd></div>
                  <div><dt className="text-muted">Allowances</dt><dd>{c.salaryVisible ? <Money value={(c.housingAllowance ?? 0) + (c.transportAllowance ?? 0) + (c.otherAllowance ?? 0)} currency={c.currency} /> : <Money value={null} currency={c.currency} />}</dd></div>
                  <div><dt className="text-muted">Total / month</dt><dd><Money value={c.totalSalary} currency={c.currency} /></dd></div>
                  <div><dt className="text-muted">Notice · hours</dt><dd>{c.noticeDays} days · {c.hoursPerWeek} h/week</dd></div>
                </dl>
                {c.file && <div className="mt-1.5"><FileLink file={c.file} /></div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {drawer && <ContractDrawer open onClose={() => setDrawer(null)} mode={drawer.mode} contract={drawer.contract} employeeId={e.id} />}
    </div>
  )
}

/* ---------------- assets ---------------- */

function AssetsTab({ e }: { e: EmployeeDetail }) {
  const stock = useAssetsQuery()
  const [pick, setPick] = useState('')
  const [assigning, setAssigning] = useState<AssetRow | null>(null)
  const [returning, setReturning] = useState<AssetRow | null>(null)
  const [losing, setLosing] = useState<AssetRow | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const inStock = e.canManage ? (stock.data ?? []).filter((a) => a.status === 'in_stock') : []
  return (
    <Card>
      <CardHeader
        title="Assets held"
        icon={<Laptop />}
        description="The offboarding can’t be completed until these are returned (or marked lost)."
        action={
          e.canManage && e.status !== 'terminated' && (
            <span className="flex gap-2">
              <SelectInput aria-label="Asset to assign" value={pick} onChange={(x) => setPick(x.target.value)} className="w-56">
                <option value="">Assign from stock…</option>
                {inStock.map((a) => (
                  <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>
                ))}
              </SelectInput>
              <Button write size="sm" variant="secondary" disabled={!pick} onClick={() => setAssigning(inStock.find((a) => a.id === pick) ?? null)}>Assign</Button>
            </span>
          )
        }
      />
      {e.assets.length === 0 ? (
        <CardBody><EmptyState icon={<Laptop />} title="No assets assigned" body="Laptops, phones, cards and vehicles handed over show here." /></CardBody>
      ) : (
        <ul className="divide-y divide-line" aria-label="Assets held">
          {e.assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[0.8125rem]">
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setViewing(a.id)}>
                <span className="font-medium text-ink hover:underline">{a.tag} · {a.name}</span>
                <span className="block text-xs text-muted">{[a.brand, a.model, a.serial].filter(Boolean).join(' · ')} · since {fmtDate(a.assignedDate)}</span>
              </button>
              {e.canManage && <AssetActions asset={a} onReturn={() => setReturning(a)} onLost={() => setLosing(a)} />}
            </li>
          ))}
        </ul>
      )}
      {assigning && <AssignModal asset={assigning} employeeId={e.id} onClose={() => { setAssigning(null); setPick('') }} />}
      {returning && <ReturnModal asset={returning} onClose={() => setReturning(null)} />}
      {losing && <LostModal asset={losing} onClose={() => setLosing(null)} />}
      <AssetDetailDrawer id={viewing} onClose={() => setViewing(null)} />
    </Card>
  )
}

/* ---------------- activity ---------------- */

function ActivityTab({ e }: { e: EmployeeDetail }) {
  return (
    <Card>
      <CardHeader title="Activity" icon={<History />} />
      <CardBody>
        {e.activity.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-3" aria-label="Activity">
            {e.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-[0.8125rem]">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="text-ink">{a.summary}</span>
                  <span className="block text-xs text-muted">{a.actorName} · {fmtDate(a.at.slice(0, 10))}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
