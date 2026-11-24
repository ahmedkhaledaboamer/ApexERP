import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgePercent, Plus, Trash2 } from 'lucide-react'
import type { Role } from '@/shared/types'
import type { CommissionBasis, CommissionPlan, CommissionPlanInput, CommissionTier } from '@/modules/finance/commissions/types'
import { COMMISSION_BASIS_LABEL } from '@/modules/finance/commissions/types'
import { commissionsApi, useCommissionsMutation, usePlans, useStatement, useStatements } from '@/modules/finance/commissions/api'
import { useFinanceScope } from '@/modules/finance/ledger/api'
import { Amount, SimpleTable, errMsg, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { StatementStatus, StatementView } from '../components/StatementView'
import { useNewParam } from '@/shared/hooks/useNewParam'

/**
 * `/finance/commissions` (?tab=statements|plans, ?statement=, ?month=): monthly commission statements (generate; Sales
 * Manager then Accountant approve; approved = posted Dr 6150 / Cr 2400 and pushed to payroll) and the plans (Company
 * Admin, Management, Accountant edit; Sales Manager views).
 */
type Tab = 'statements' | 'plans'
const ROLES: Role[] = ['Sales Agent', 'Sales Manager', 'Department Head', 'Employee']

const prevMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export default function CommissionsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'statements'
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  return (
    <>
      <PageHeader icon={<IconTile><BadgePercent /></IconTile>} title="Commissions" description="Sales commission plans and monthly statements, approved by the Sales Manager and an Accountant, then paid through payroll." />
      <PageBody className="space-y-5">
        <Tabs<Tab> label="Commission sections" value={tab} onChange={(t) => set('tab', t)} items={[{ id: 'statements', label: 'Statements' }, { id: 'plans', label: 'Plans' }]} />
        <div id={`tab-panel-${tab}`} role="tabpanel">
          {tab === 'statements' ? <StatementsTab month={params.get('month') ?? prevMonth()} onMonth={(m) => set('month', m)} open={params.get('statement')} onOpen={(id) => set('statement', id)} /> : <PlansTab />}
        </div>
      </PageBody>
    </>
  )
}

function StatementsTab({ month, onMonth, open, onOpen }: { month: string; onMonth: (m: string) => void; open: string | null; onOpen: (id: string | null) => void }) {
  const q = useStatements(month)
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const gen = useCommissionsMutation(() => commissionsApi.generate(month))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field id="com-month" label="Month"><TextInput id="com-month" type="month" value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} /></Field>
        {isFull && <Button write loading={gen.isPending} onClick={() => gen.mutate(undefined, { onSuccess: (r) => toast.success('Statements generated', `${r.length} statement${r.length === 1 ? '' : 's'}`), onError: (e) => toast.error('Not generated', e.message) })}>Generate statements</Button>}
      </div>
      {q.isError ? <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : !q.data.length ? (
        <EmptyState title={`No statements for ${monthName(month)}`} body="Generate them once the month’s collections are in." />
      ) : (
        <SimpleTable label="Commission statements" head={<tr><th className={th}>Statement</th><th className={th}>Rep</th><th className={thEnd}>Base</th><th className={thEnd}>Rate</th><th className={thEnd}>Commission</th><th className={th}>Status</th></tr>}>
          {q.data.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(s.id)}>
              <td className={`${td} num`}><button type="button" className="text-brand-700 hover:underline dark:text-brand-300" onClick={() => onOpen(s.id)}>{s.number}</button></td>
              <td className={td}>{s.userName}</td>
              <td className={tdEnd}><Amount value={s.baseTotal} /></td>
              <td className={tdEnd}>{s.rate} %</td>
              <td className={tdEnd}><Amount value={s.total} currency={s.currency} strong /></td>
              <td className={td}><StatementStatus s={s} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {open && <StatementDrawer id={open} onClose={() => onOpen(null)} />}
    </div>
  )
}

function StatementDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useStatement(id)
  const toast = useToast()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const approve = useCommissionsMutation(() => commissionsApi.approve(id))
  const reject = useCommissionsMutation(() => commissionsApi.reject(id, reason))
  const s = q.data
  const pending = s && (s.status === 'pending_manager' || s.status === 'pending_accountant')
  return (
    <Drawer variant="sheet"
      open
      onClose={onClose}
      title={s ? `${s.userName} · ${monthName(s.month)}` : 'Commission statement'}
      footer={
        pending ? (
          <>
            <Button variant="secondary" disabled={!s!.canApprove} onClick={() => setRejecting(true)}>Reject</Button>
            <Button write disabled={!s!.canApprove} title={s!.approveBlockedReason ?? undefined} loading={approve.isPending} onClick={() => approve.mutate(undefined, { onSuccess: (r) => toast.success(r.status === 'approved' ? 'Approved and posted' : 'Approved', r.number), onError: (e) => toast.error('Not approved', e.message) })}>
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      {q.isError ? <ErrorState message={errMsg(q.error)} /> : !s ? <Skeleton className="h-64" /> : (
        <>
          <StatementView s={s} />
          {pending && s.approveBlockedReason && <p className="mt-3 text-xs text-muted">{s.approveBlockedReason}</p>}
        </>
      )}
      {rejecting && (
        <Modal open onClose={() => setRejecting(false)} title="Reject statement" footer={<Button write variant="danger" disabled={!reason.trim()} loading={reject.isPending} onClick={() => reject.mutate(undefined, { onSuccess: () => { toast.success('Rejected'); setRejecting(false) }, onError: (e) => toast.error('Not rejected', e.message) })}>Reject</Button>}>
          <Field id="rej-reason" label="Reason" required><TextInput id="rej-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </Modal>
      )}
    </Drawer>
  )
}

function PlansTab() {
  const q = usePlans()
  const { scope, role } = useFinanceScope()
  const canEdit = scope === 'full' && (role === 'Company Admin' || role === 'Management' || role === 'Accountant')
  const [editing, setEditing] = useState<CommissionPlan | 'new' | null>(null)
  useNewParam(() => setEditing('new'), { when: canEdit })
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-48" />
  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button write onClick={() => setEditing('new')}><Plus />New plan</Button></div>}
      <SimpleTable label="Commission plans" head={<tr><th className={th}>Plan</th><th className={th}>Basis</th><th className={th}>Rate / tiers</th><th className={thEnd}>Cap / month</th><th className={th}>Who</th><th className={th} /></tr>}>
        {q.data.map((p) => (
          <tr key={p.id} className={p.active ? '' : 'opacity-60'}>
            <td className={td}><div className="font-medium text-ink">{p.name}</div><div className="text-xs text-muted">From {monthName(p.effectiveFrom)}{p.clawback ? ' · clawback' : ''}{p.active ? '' : ' · inactive'}</div></td>
            <td className={td}>{COMMISSION_BASIS_LABEL[p.basis]}</td>
            <td className={td}>{p.rate} %{p.tiers.map((t) => ` · ≥${t.minAchievement}% → ${t.rate} %`).join('')}</td>
            <td className={tdEnd}>{p.capPerMonth === null ? '—' : <Amount value={p.capPerMonth} />}</td>
            <td className={td}>{[...p.roles, ...p.userNames].join(', ')}</td>
            <td className={`${td} text-end`}>{canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>}</td>
          </tr>
        ))}
      </SimpleTable>
      {editing && <PlanModal plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function PlanModal({ plan, onClose }: { plan: CommissionPlan | null; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState<Required<Omit<CommissionPlanInput, 'userIds'>>>({
    name: plan?.name ?? '',
    basis: plan?.basis ?? 'collected_revenue',
    rate: plan?.rate ?? 3,
    tiers: plan?.tiers ?? [],
    capPerMonth: plan?.capPerMonth ?? null,
    clawback: plan?.clawback ?? true,
    roles: plan?.roles ?? ['Sales Agent'],
    effectiveFrom: plan?.effectiveFrom ?? new Date().toISOString().slice(0, 7),
    active: plan?.active ?? true,
  })
  const save = useCommissionsMutation(() => (plan ? commissionsApi.updatePlan(plan.id, f) : commissionsApi.createPlan(f)))
  const setTier = (i: number, t: Partial<CommissionTier>) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, ...t } : x)) })
  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? `Edit ${plan.name}` : 'New commission plan'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Plan saved'); onClose() }, onError: (e) => toast.error('Not saved', e.message) })}>Save</Button></>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="pl-name" label="Name" required><TextInput id="pl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field id="pl-basis" label="Basis"><SelectInput id="pl-basis" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as CommissionBasis })}>{Object.entries(COMMISSION_BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectInput></Field>
        <Field id="pl-rate" label="Base rate (%)"><TextInput id="pl-rate" inputMode="decimal" value={String(f.rate)} onChange={(e) => setF({ ...f, rate: Number(e.target.value) || 0 })} /></Field>
        <Field id="pl-cap" label="Cap per month" hint="Empty = no cap"><TextInput id="pl-cap" inputMode="decimal" value={f.capPerMonth === null ? '' : String(f.capPerMonth)} onChange={(e) => setF({ ...f, capPerMonth: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field id="pl-from" label="Effective from"><TextInput id="pl-from" type="month" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
        <div className="space-y-1 text-[0.8125rem]">
          <label className="flex items-center gap-2"><Checkbox checked={f.clawback} onChange={(e) => setF({ ...f, clawback: e.target.checked })} />Claw back credited / refunded invoices</label>
          <label className="flex items-center gap-2"><Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs text-muted">Who earns</legend>
          <div className="flex flex-wrap gap-3 text-[0.8125rem]">
            {ROLES.map((r) => <label key={r} className="flex items-center gap-2"><Checkbox checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />{r}</label>)}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2 space-y-2">
          <legend className="mb-1 text-xs text-muted">Tiers by sales-target achievement</legend>
          {f.tiers.map((t, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field id={`tier-min-${i}`} label="From achievement (%)"><TextInput id={`tier-min-${i}`} inputMode="numeric" value={String(t.minAchievement)} onChange={(e) => setTier(i, { minAchievement: Number(e.target.value) || 0 })} /></Field>
              <Field id={`tier-rate-${i}`} label="Rate (%)"><TextInput id={`tier-rate-${i}`} inputMode="decimal" value={String(t.rate)} onChange={(e) => setTier(i, { rate: Number(e.target.value) || 0 })} /></Field>
              <Button variant="ghost" iconOnly aria-label="Remove tier" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setF({ ...f, tiers: [...f.tiers, { minAchievement: 100, rate: f.rate + 1 }] })}><Plus />Add tier</Button>
        </fieldset>
      </div>
    </Modal>
  )
}
