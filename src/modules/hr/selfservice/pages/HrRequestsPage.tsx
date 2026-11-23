import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, Check, Inbox, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import { letterPath } from '@/app/paths'
import { MaskedValue } from '@/modules/hr/components/PeopleBits'
import { useEmployeesQuery } from '@/modules/hr/hooks/useHrPeople'
import { errorMessage, F, Table, td } from '@/modules/hr/time/components/shared'
import { PLACEHOLDERS, letterDate, letterDateAr, renderTemplate, validateTemplate, type LetterValues } from '../letters'
import { RevokeModal } from './LetterPage'
import { selfServiceApi, useInbox, useLetterRequests, useLetterTypes, useProfileChanges, useSelfServiceMutation } from '../api'
import { STATUS_TONE } from './MyHrPage'
import {
  LETTER_LANGUAGE_LABEL,
  LETTER_STATUS_LABEL,
  NOC_PURPOSES,
  NOC_PURPOSE_LABEL,
  PROFILE_CHANGE_FIELD_LABEL,
  PROFILE_CHANGE_STATUS_LABEL,
  type LetterRequestRow,
  type LetterType,
  type LetterVerification,
  type NocPurpose,
  type ProfileChangeRequest,
  type ProfileChangeValues,
} from '../types'

type Tab = 'profile' | 'letters' | 'templates' | 'verify'

/** `/hr/requests` (HR full): the self-service inbox — profile changes and letter requests — plus letter templates and verification. */
export default function HrRequestsPage() {
  const [params, setParams] = useSearchParams()
  const inbox = useInbox()
  const c = inbox.data?.counts
  const items = [
    { id: 'profile' as const, label: `Profile changes${c ? ` (${c.profileChanges})` : ''}` },
    { id: 'letters' as const, label: `Letter requests${c ? ` (${c.letters})` : ''}` },
    { id: 'templates' as const, label: 'Letter templates' },
    { id: 'verify' as const, label: 'Verify a letter' },
  ]
  const requested = params.get('tab') as Tab | null
  const tab: Tab = items.some((i) => i.id === requested) ? requested! : 'profile'
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Inbox />
          </IconTile>
        }
        title="Employee requests"
        description="Requests employees send from My HR: profile changes and HR letters. Approve, reject with a reason, edit the letter templates, and check a letter’s verification code."
      >
        <Tabs label="Employee request views" items={items} value={tab} onChange={(id) => setParams((p) => { p.set('tab', id); return p }, { replace: true })} />
      </PageHeader>
      <PageBody className="space-y-4">
        {tab === 'profile' && <ProfileChangesView />}
        {tab === 'letters' && <LettersView />}
        {tab === 'templates' && <TemplatesView />}
        {tab === 'verify' && <VerifyView />}
      </PageBody>
    </>
  )
}

/* ---------------- profile changes ---------------- */

function valuesText(v: ProfileChangeValues, f: ProfileChangeRequest['fields'][number]): string {
  if (f === 'mobile') return v.mobile ?? '—'
  if (f === 'emergency_contact') return v.emergencyContact ? [v.emergencyContact.name, v.emergencyContact.relation, v.emergencyContact.phone].filter(Boolean).join(' · ') || '—' : '—'
  if (f === 'address') return v.address ? [v.address.line1, v.address.city, v.address.country].filter(Boolean).join(', ') || '—' : '—'
  return v.bank ? [v.bank.bankName, v.bank.accountName, v.bank.ibanMasked].filter(Boolean).join(' · ') || '—' : '—'
}

function ProfileChangesView() {
  const q = useProfileChanges()
  const [decide, setDecide] = useState<{ c: ProfileChangeRequest; action: 'approve' | 'reject' } | null>(null)
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  if (!q.data.length) return <EmptyState title="No profile change requests" body="Employees ask for changes to their contact details and bank account from My HR." icon={<Inbox />} />
  return (
    <>
      <Table label="Profile change requests" head={['Employee', 'Current', 'Requested', 'Requested by', 'Status', '']} minWidth={900}>
        {q.data.map((c) => (
          <tr key={c.id}>
            <td className={`${td} text-ink`}>
              {c.employeeName}
              <span className="block text-xs text-muted">{c.employeeNo} · {fmtDate(c.createdAt)}</span>
            </td>
            <td className={td}>
              {c.fields.map((f) => (
                <span key={f} className="block text-xs">
                  <span className="text-muted">{PROFILE_CHANGE_FIELD_LABEL[f]}:</span> {valuesText(c.current, f)}
                </span>
              ))}
            </td>
            <td className={td}>
              {c.fields.map((f) =>
                f === 'bank' && c.proposed.bank ? (
                  <span key={f} className="block text-xs">
                    {[c.proposed.bank.bankName, c.proposed.bank.accountName].filter(Boolean).join(' · ')}{' '}
                    <MaskedValue masked={c.proposed.bank.ibanMasked} canReveal={c.canReveal} reveal={() => selfServiceApi.revealProfileChangeIban(c.id)} label="new IBAN" />
                  </span>
                ) : (
                  <span key={f} className="block text-xs font-medium text-ink">
                    {valuesText(c.proposed, f)}
                  </span>
                ),
              )}
              {c.note && <span className="mt-1 block text-xs text-muted">“{c.note}”</span>}
            </td>
            <td className={td}>{c.requestedByName}</td>
            <td className={td}>
              <Badge tone={STATUS_TONE[c.status]}>{PROFILE_CHANGE_STATUS_LABEL[c.status]}</Badge>
              {c.ibanChange && <Badge tone="amber" className="ms-1">Bank account</Badge>}
              {c.decisionComment && <span className="mt-0.5 block text-xs text-muted">{c.decidedByName}: {c.decisionComment}</span>}
            </td>
            <td className={`${td} text-end whitespace-nowrap`}>
              {c.canDecide && (
                <>
                  <Button size="sm" onClick={() => setDecide({ c, action: 'approve' })}>
                    <Check />
                    Approve
                  </Button>{' '}
                  <Button size="sm" variant="secondary" onClick={() => setDecide({ c, action: 'reject' })}>
                    <X />
                    Reject
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {decide && <DecideModal kind="profile" id={decide.c.id} action={decide.action} who={decide.c.employeeName} what={decide.c.fields.map((f) => PROFILE_CHANGE_FIELD_LABEL[f]).join(', ')} warning={decide.c.ibanChange ? 'This changes the account the salary is paid into. Confirm the new IBAN with the employee (Show) before approving. The approval is audited.' : undefined} onClose={() => setDecide(null)} />}
    </>
  )
}

function DecideModal(props: { kind: 'profile' | 'letter'; id: string; action: 'approve' | 'reject'; who: string; what: string; warning?: string; needsOverride?: boolean; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const profile = useSelfServiceMutation(selfServiceApi.decideProfileChange)
  const letter = useSelfServiceMutation(selfServiceApi.decideLetter)
  const m = props.kind === 'profile' ? profile : letter
  const approve = props.action === 'approve'
  function go() {
    const done = {
      onSuccess: () => {
        toast.success(approve ? (props.kind === 'letter' ? 'Letter issued' : 'Change approved') : 'Request rejected')
        props.onClose()
      },
    }
    if (props.kind === 'profile') profile.mutate({ id: props.id, action: props.action, reason }, done)
    else letter.mutate({ id: props.id, action: props.action, reason: approve ? undefined : reason, overrideReason: approve ? reason : undefined }, done)
  }
  const confirm = approve ? (props.kind === 'letter' ? 'Issue letter' : 'Approve change') : 'Reject request'
  return (
    <Modal
      open
      onClose={props.onClose}
      title={`${approve ? 'Approve' : 'Reject'}: ${props.what}`}
      description={`${props.who}. ${approve ? (props.kind === 'letter' ? 'The letter is issued with the next reference number and you as the signatory.' : 'The employee record is updated now.') : 'The employee sees your reason.'}`}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant={approve ? 'primary' : 'danger'} onClick={go} loading={m.isPending}>
            {confirm}
          </Button>
        </>
      }
    >
      {props.warning && <p className="mb-3 rounded-lg bg-warning-50 p-3 text-[0.8125rem] text-warning-800 dark:bg-warning-950 dark:text-warning-200">{props.warning}</p>}
      {(!approve || props.needsOverride || props.kind === 'profile') && (
        <F label={approve ? (props.needsOverride ? 'Override reason (the employee isn’t leaving)' : 'Comment (optional)') : 'Reason'}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </F>
      )}
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}

/* ---------------- letters ---------------- */

function LettersView() {
  const q = useLetterRequests()
  const [decide, setDecide] = useState<{ r: LetterRequestRow; action: 'approve' | 'reject' } | null>(null)
  const [revoke, setRevoke] = useState<LetterRequestRow | null>(null)
  const [onBehalf, setOnBehalf] = useState(false)
  return (
    <>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setOnBehalf(true)}>
          <Plus />
          Request for an employee
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState title="No letter requests" body="Employees request letters from My HR; you can also file one for them." icon={<Inbox />} />
      ) : (
        <Table label="Letter requests" head={['Employee', 'Letter', 'Addressee / purpose', 'Status', '']} minWidth={960}>
          {q.data.map((r) => (
            <tr key={r.id}>
              <td className={`${td} text-ink`}>
                {r.employeeName}
                <span className="block text-xs text-muted">{r.employeeNo} · {fmtDate(r.createdAt)}{r.onBehalf ? ` · filed by ${r.requestedByName}` : ''}</span>
              </td>
              <td className={td}>
                {r.typeName}
                {r.includesSalary && <span className="block text-xs text-muted">Shows salary</span>}
                <span className="block text-xs text-muted" data-testid="letter-language">
                  {LETTER_LANGUAGE_LABEL[r.language]}
                  {r.language !== 'en' && r.digits === 'arabic' ? ' · Arabic digits' : ''}
                </span>
              </td>
              <td className={td}>
                {r.addressee}
                {(r.purpose || r.nocPurpose) && <span className="block text-xs text-muted">{[r.nocPurpose ? NOC_PURPOSE_LABEL[r.nocPurpose] : '', r.purpose].filter(Boolean).join(': ')}</span>}
                {r.languageNote && <span className="block text-xs text-muted">Language: {r.languageNote}</span>}
                {r.overrideReason && <span className="block text-xs text-muted">Override: {r.overrideReason}</span>}
              </td>
              <td className={td}>
                <Badge tone={STATUS_TONE[r.status]}>{LETTER_STATUS_LABEL[r.status]}</Badge>
                {r.rejectionReason && <span className="mt-0.5 block text-xs text-muted">{r.rejectionReason}</span>}
                {r.revokeReason && <span className="mt-0.5 block text-xs text-muted">{r.revokedByName}: {r.revokeReason}</span>}
              </td>
              <td className={`${td} text-end whitespace-nowrap`}>
                {(r.status === 'issued' || r.status === 'revoked') && (
                  <Link to={letterPath(r.id)} className="text-[0.8125rem] font-medium text-accent-700 hover:underline dark:text-accent-300">
                    Open {r.referenceNo}
                  </Link>
                )}
                {r.canRevoke && (
                  <Button size="sm" variant="ghost" className="ms-2" onClick={() => setRevoke(r)}>
                    <Ban />
                    Revoke
                  </Button>
                )}
                {r.canDecide && (
                  <>
                    <Button size="sm" onClick={() => setDecide({ r, action: 'approve' })}>
                      <Check />
                      Approve
                    </Button>{' '}
                    <Button size="sm" variant="secondary" onClick={() => setDecide({ r, action: 'reject' })}>
                      <X />
                      Reject
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {decide && (
        <DecideModal
          kind="letter"
          id={decide.r.id}
          action={decide.action}
          who={decide.r.employeeName}
          what={decide.r.typeName}
          needsOverride={decide.r.code === 'experience_letter' && !decide.r.overrideReason}
          warning={decide.action === 'approve' && decide.r.includesSalary ? 'This letter shows the employee’s salary from the active contract.' : undefined}
          onClose={() => setDecide(null)}
        />
      )}
      {onBehalf && <OnBehalfModal onClose={() => setOnBehalf(false)} />}
      {revoke && <RevokeModal id={revoke.id} what={`${revoke.typeName} ${revoke.referenceNo ?? ''}`} onClose={() => setRevoke(null)} />}
    </>
  )
}

function OnBehalfModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const employees = useEmployeesQuery()
  const types = useLetterTypes()
  const [employeeId, setEmployeeId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [addressee, setAddressee] = useState('')
  const [purpose, setPurpose] = useState('')
  const [noc, setNoc] = useState<NocPurpose>('travel')
  const [overrideReason, setOverride] = useState('')
  const t = types.data?.find((x) => x.id === typeId)
  const m = useSelfServiceMutation(selfServiceApi.requestLetter)
  return (
    <Modal
      open
      onClose={onClose}
      title="Request a letter for an employee"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={m.isPending}
            disabled={!employeeId || !typeId}
            onClick={() =>
              m.mutate(
                { letterTypeId: typeId, employeeId, addressee, purpose, nocPurpose: t?.code === 'noc' ? noc : null, overrideReason },
                {
                  onSuccess: () => {
                    toast.success('Letter requested')
                    onClose()
                  },
                },
              )
            }
          >
            Create request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <F label="Employee">
          <SelectInput value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Pick an employee…</option>
            {(employees.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} ({e.employeeNo})
              </option>
            ))}
          </SelectInput>
        </F>
        <F label="Letter">
          <SelectInput value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Pick a letter…</option>
            {(types.data ?? []).filter((x) => x.active).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </SelectInput>
        </F>
        <F label="Addressee">
          <TextInput value={addressee} onChange={(e) => setAddressee(e.target.value)} />
        </F>
        {t?.code === 'noc' && (
          <F label="NOC for">
            <SelectInput value={noc} onChange={(e) => setNoc(e.target.value as NocPurpose)}>
              {NOC_PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {NOC_PURPOSE_LABEL[x]}
                </option>
              ))}
            </SelectInput>
          </F>
        )}
        <F label="Purpose">
          <TextInput value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </F>
        {t?.code === 'experience_letter' && (
          <F label="Override reason" hint="Only needed when the employee isn’t in a notice period and hasn’t left.">
            <TextInput value={overrideReason} onChange={(e) => setOverride(e.target.value)} />
          </F>
        )}
      </div>
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}

/* ---------------- templates ---------------- */

/** Synthetic sample values for the editor preview (no real employee data leaves the server for it). */
const SAMPLE: LetterValues = {
  'employee.fullName': 'Sam Example',
  'employee.salutation': 'Mr.',
  'employee.pronoun': 'he',
  'employee.possessive': 'his',
  'employee.object': 'him',
  'employee.employeeNo': 'EMP-0000',
  'employee.jobTitle': 'Analyst',
  'employee.department': 'Operations',
  'employee.nationality': 'India',
  'employee.hireDate': '1 March 2023',
  'employee.exitDate': '31 December 2026',
  'employee.employmentType': 'full time',
  'salary.basic': '10,000.00',
  'salary.housing': '4,000.00',
  'salary.transport': '1,000.00',
  'salary.other': '0.00',
  'salary.allowances': '5,000.00',
  'salary.total': '15,000.00',
  'salary.currency': 'AED',
  'bank.name': 'Sample Bank',
  'bank.ibanLast4': '1234',
  'company.name': 'Your company',
  'company.legalName': 'Your company LLC',
  'company.address': 'Street 1, City',
  'company.country': 'United Arab Emirates',
  'letter.date': letterDate(new Date().toISOString().slice(0, 10)),
  'letter.referenceNo': 'XXX-HRL-2026-0001',
  addressee: 'To whom it may concern',
  purpose: 'whatever purpose it may serve',
  'noc.purpose': 'Travel',
  'signatory.name': 'HR Manager',
  'signatory.title': 'HR Manager',
}

/** Arabic sample values for the Arabic template preview (synthetic). */
const SAMPLE_AR: LetterValues = {
  ...SAMPLE,
  'employee.fullName': 'سامي مثال',
  'employee.salutation': 'السيد',
  'employee.jobTitle': 'محلل',
  'employee.nationality': 'الهند',
  'employee.hireDate': letterDateAr('2023-03-01'),
  'employee.exitDate': letterDateAr('2026-12-31'),
  'employee.employmentType': 'دوام كامل',
  'salary.currency': 'درهم إماراتي',
  'company.name': 'شركتكم',
  'company.legalName': 'شركتكم ذ.م.م',
  'company.country': 'الإمارات العربية المتحدة',
  'letter.date': letterDateAr(new Date().toISOString().slice(0, 10)),
  addressee: 'لمن يهمه الأمر',
  purpose: 'تقديمها لمن يهمه الأمر',
  'noc.purpose': 'السفر',
}

function TemplatesView() {
  const q = useLetterTypes()
  const [selected, setSelected] = useState<string>('')
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  const current = q.data.find((t) => t.id === selected) ?? q.data[0]
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Letter types" className="space-y-1">
        {q.data.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelected(t.id)}
            className={`block w-full rounded-lg px-3 py-2 text-start text-[0.8125rem] ${t.id === current?.id ? 'bg-accent-50 font-medium text-accent-800 dark:bg-accent-950 dark:text-accent-200' : 'text-ink-2 hover:bg-sunken'}`}
          >
            {t.name}
            <span className="block text-xs text-muted">{[t.includesSalary ? 'shows salary' : 'no salary', t.active ? '' : 'inactive', t.isDefault ? '' : 'edited'].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </nav>
      {current && <TemplateEditor key={`${current.id}:${current.updatedAt}`} t={current} />}
    </div>
  )
}

function TemplateEditor({ t }: { t: LetterType }) {
  const toast = useToast()
  const [name, setName] = useState(t.name)
  const [description, setDescription] = useState(t.description)
  const [body, setBody] = useState(t.body)
  const [nameAr, setNameAr] = useState(t.nameAr)
  const [bodyAr, setBodyAr] = useState(t.bodyAr)
  const [active, setActive] = useState(t.active)
  const save = useSelfServiceMutation(selfServiceApi.saveLetterType)
  const reset = useSelfServiceMutation(selfServiceApi.resetLetterType)
  const problems = [...validateTemplate(body, t.includesSalary), ...validateTemplate(bodyAr, t.includesSalary, { optional: true }).map((x) => `Arabic: ${x}`)]
  const preview = useMemo(() => renderTemplate(body, SAMPLE).text, [body])
  const previewAr = useMemo(() => renderTemplate(bodyAr, SAMPLE_AR, { rtl: true }).text, [bodyAr])
  const allowed = PLACEHOLDERS.filter((p) => t.includesSalary || !p.salary)
  return (
    <section aria-label={`Template ${t.name}`} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </F>
        <F label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
        </F>
      </div>
      <Switch checked={active} onChange={setActive} label="Employees can request it" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <F label="Template" hint={t.includesSalary ? 'Salary letter: pay placeholders allowed.' : 'No pay or bank placeholders in this letter.'}>
            <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={18} className="font-mono text-xs" />
          </F>
          {problems.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-xs text-danger-700 dark:text-danger-300" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">Placeholders</summary>
            <ul className="mt-1 grid gap-0.5">
              {allowed.map((p) => (
                <li key={p.key}>
                  <code className="text-ink">{`{{${p.key}}}`}</code> <span className="text-muted">{p.label}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Preview with sample data</p>
          <div className="min-h-64 rounded-lg border border-line bg-sunken p-3 text-[0.8125rem] whitespace-pre-line text-ink" dir="auto" data-testid="template-preview">
            {preview}
          </div>
        </div>
      </div>
      <div className="grid gap-4 border-t border-line pt-3 xl:grid-cols-2">
        <div className="space-y-3">
          <F label="Arabic name">
            <TextInput dir="rtl" lang="ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </F>
          <F label="Arabic template" hint="Same placeholders, filled with Arabic values (name and job title in Arabic, Arabic legal name). Leave empty to offer this letter in English only.">
            <TextArea dir="rtl" lang="ar" value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} rows={14} className="text-[0.8125rem]" />
          </F>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Arabic preview with sample data</p>
          <div className="min-h-64 rounded-lg border border-line bg-sunken p-3 text-[0.875rem] leading-loose whitespace-pre-line text-ink" dir="rtl" lang="ar" data-testid="template-preview-ar">
            {previewAr || '—'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => reset.mutate(t.id, { onSuccess: () => toast.success('Template reset to the default') })} loading={reset.isPending} disabled={t.isDefault}>
          <RotateCcw />
          Reset to default
        </Button>
        <Button
          onClick={() => save.mutate({ id: t.id, input: { name, description, body, nameAr, bodyAr, active } }, { onSuccess: () => toast.success('Template saved'), onError: (e) => toast.error('Not saved', errorMessage(e)) })}
          loading={save.isPending}
          disabled={problems.length > 0}
        >
          Save template
        </Button>
      </div>
    </section>
  )
}

/* ---------------- verify ---------------- */

function VerifyView() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<LetterVerification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function check() {
    setBusy(true)
    setError(null)
    try {
      setResult(await selfServiceApi.verify(code))
    } catch (e) {
      setResult(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Verify a letter" className="max-w-xl space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-[0.8125rem] text-muted">Someone asks whether a letter is genuine? Enter the verification code printed at the bottom of the letter. Only letters of this company are found.</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <F label="Verification code">
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKMN" />
          </F>
        </div>
        <Button className="self-end" onClick={check} loading={busy} disabled={!code.trim()}>
          <ShieldCheck />
          Check
        </Button>
      </div>
      {error && <p className="text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{error}</p>}
      {result && (
        <div role="status" className={`rounded-lg p-3 text-[0.8125rem] ${result.valid ? 'bg-success-50 text-success-800 dark:bg-success-950 dark:text-success-200' : 'bg-danger-50 text-danger-800 dark:bg-danger-950 dark:text-danger-200'}`}>
          {result.status !== 'not_found' ? (
            <>
              <p className="font-semibold">{result.valid ? 'Authentic letter' : `Revoked letter${result.revokedAt ? ` (revoked ${fmtDate(result.revokedAt)})` : ''}`}</p>
              <p>
                {result.typeName} {result.referenceNo} for {result.employeeName} ({result.employeeNo}), issued {letterDate(result.issueDate)} by {result.issuedByName}.
              </p>
            </>
          ) : (
            <p className="font-semibold">No letter of this company has this code.</p>
          )}
        </div>
      )}
    </section>
  )
}
