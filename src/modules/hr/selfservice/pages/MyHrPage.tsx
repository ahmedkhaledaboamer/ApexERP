import { Suspense, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CircleUser, Mail, Plane, Plus, Undo2 } from 'lucide-react'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import { countryLabel } from '@/shared/lib/country'
import { letterPath, myPayslipPath, PATHS } from '@/app/paths'
import { EMPLOYMENT_STATUS_LABEL } from '@/modules/hr/types'
import { ASSET_CATEGORY_LABEL, CONTRACT_TYPE_LABEL, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { CERTIFICATE_STATE_LABEL, ENROLLMENT_STATUS_LABEL } from '@/modules/hr/trainingTypes'
import { DocumentStatusBadge } from '@/modules/hr/components/PeopleBits'
import { fmt2 } from '@/modules/hr/payroll/components/bits'
import { monthLabel as payMonthLabel } from '@/modules/hr/payroll/calc'
import { useMyAttendance, useMyLeave } from '@/modules/hr/time/api'
import { ClockCard } from '@/modules/hr/time/pages/AttendancePage'
import { RequestForm as LeaveRequestForm } from '@/modules/hr/time/pages/LeavePage'
import { errorCode, errorMessage, F, Metric, Table, td } from '@/modules/hr/time/components/shared'
import { fmtMinutes } from '@/modules/hr/time/calc'
import { selfServiceApi, useMyHr, useSelfServiceMutation } from '../api'
import { MY_HR_SLOTS, PORTAL_SLOT_ORDER } from '../portalSlots'
import {
  BILINGUAL_LAYOUTS,
  BILINGUAL_LAYOUT_LABEL,
  DIGIT_STYLE_LABEL,
  LETTER_LANGUAGES,
  LETTER_LANGUAGE_LABEL,
  LETTER_STATUS_LABEL,
  NOC_PURPOSES,
  NOC_PURPOSE_LABEL,
  PROFILE_CHANGE_FIELD_LABEL,
  PROFILE_CHANGE_STATUS_LABEL,
  type BilingualLayout,
  type DigitStyle,
  type LetterLanguage,
  type LetterStatus,
  type MyHr,
  type NocPurpose,
  type ProfileChangeInput,
  type ProfileChangeStatus,
} from '../types'

export const STATUS_TONE: Record<LetterStatus | ProfileChangeStatus, Tone> = { pending: 'amber', issued: 'green', approved: 'green', rejected: 'red', cancelled: 'neutral', revoked: 'red' }

/** `/hr/me`: "My HR", the self-service portal of every employee (any role with an employee record). Own data only. */
export default function MyHrPage() {
  const q = useMyHr()
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <CircleUser />
          </IconTile>
        }
        title="My HR"
        description="Your profile, documents, contract, leave and attendance, payslips, assets, training and HR letters in one place. Only you (and HR) see this."
      />
      <PageBody className="space-y-4">
        {q.isPending ? (
          <Skeleton className="h-96" />
        ) : q.error ? (
          errorCode(q.error) === 'no_employee_record' ? (
            <EmptyState title="No employee record" body="You don’t have an employee record in this company yet. Ask HR to add you." icon={<CircleUser />} />
          ) : (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          )
        ) : (
          <Portal d={q.data} />
        )}
      </PageBody>
    </>
  )
}

function Card({ title, actions, children, label }: { title: string; actions?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Pairs({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-ink">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

const muted = (s: string) => <p className="text-[0.8125rem] text-muted">{s}</p>

function Portal({ d }: { d: MyHr }) {
  const [changeOpen, setChangeOpen] = useState(false)
  const [letterOpen, setLetterOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const toast = useToast()
  const cancelChange = useSelfServiceMutation(selfServiceApi.decideProfileChange)
  const cancelLetter = useSelfServiceMutation(selfServiceApi.decideLetter)
  const e = d.employee
  const p = d.profile
  const pendingChange = d.profileChanges.find((c) => c.status === 'pending')
  const k = d.contract
  return (
    <>
      <section aria-label="Me" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 shadow-xs">
        <div>
          <p className="text-[1.125rem] font-semibold text-ink">{e.fullName}</p>
          <p className="text-[0.8125rem] text-muted">
            {e.jobTitle}
            {e.departmentName ? ` · ${e.departmentName}` : ''} · {e.employeeNo}
          </p>
        </div>
        <Badge tone={e.status === 'active' ? 'green' : e.status === 'notice' ? 'amber' : 'neutral'}>{EMPLOYMENT_STATUS_LABEL[e.status]}</Badge>
        <p className="text-[0.8125rem] text-muted">
          Joined {fmtDate(e.hireDate)}
          {e.managerName ? ` · reports to ${e.managerName}` : ''}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <TimeCards onRequestLeave={() => setLeaveOpen(true)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="My profile"
          actions={
            pendingChange ? null : (
              <Button size="sm" variant="secondary" onClick={() => setChangeOpen(true)}>
                Request a change
              </Button>
            )
          }
        >
          <Pairs
            rows={[
              ['Email', e.email],
              ['Mobile', p.mobile],
              ['Nationality', countryLabel(e.nationality)],
              ['Emergency contact', [p.emergencyContact.name, p.emergencyContact.relation, p.emergencyContact.phone].filter(Boolean).join(' · ')],
              ['Address', [p.address.line1, p.address.city, p.address.country ? countryLabel(p.address.country) : ''].filter(Boolean).join(', ')],
              ['Bank account', [p.bank.bankName, p.bank.ibanMasked].filter(Boolean).join(' ')],
            ]}
          />
          {pendingChange && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-[0.8125rem] dark:border-warning-800 dark:bg-warning-950" data-testid="pending-change">
              <span>
                Waiting for HR: {pendingChange.fields.map((f) => PROFILE_CHANGE_FIELD_LABEL[f]).join(', ')}
                {pendingChange.proposed.mobile ? ` → ${pendingChange.proposed.mobile}` : ''}
                {pendingChange.proposed.bank ? ` → ${pendingChange.proposed.bank.ibanMasked}` : ''}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => cancelChange.mutate({ id: pendingChange.id, action: 'cancel' }, { onSuccess: () => toast.success('Request cancelled'), onError: (er) => toast.error('Couldn’t cancel', errorMessage(er)) })}
              >
                <Undo2 />
                Cancel request
              </Button>
            </div>
          )}
          {d.profileChanges.filter((c) => c.status !== 'pending').slice(0, 3).map((c) => (
            <p key={c.id} className="mt-2 text-xs text-muted">
              {fmtDate(c.decidedAt ?? c.createdAt)} · {c.fields.map((f) => PROFILE_CHANGE_FIELD_LABEL[f]).join(', ')}: <Badge tone={STATUS_TONE[c.status]}>{PROFILE_CHANGE_STATUS_LABEL[c.status]}</Badge>
              {c.decisionComment ? ` — ${c.decisionComment}` : ''}
            </p>
          ))}
        </Card>

        <Card title="My contract">
          {k ? (
            <Pairs
              rows={[
                ['Type', CONTRACT_TYPE_LABEL[k.type]],
                ['Period', `${fmtDate(k.startDate)} – ${k.endDate ? fmtDate(k.endDate) : 'open-ended'}`],
                ['Probation', k.probationEndDate ? `until ${fmtDate(k.probationEndDate)}${k.inProbation ? ' (in probation)' : ''}` : 'None'],
                ['Notice', `${k.noticeDays} days`],
                ['Basic salary', k.basicSalary !== null ? `${k.currency} ${fmt2(k.basicSalary)}` : '•••'],
                ['Total monthly pay', k.totalSalary !== null ? `${k.currency} ${fmt2(k.totalSalary)}` : '•••'],
              ]}
            />
          ) : (
            muted('No active contract on file. Ask HR.')
          )}
        </Card>
      </div>

      <Card title="My documents">
        {d.documents.length ? (
          <Table label="My documents" head={['Document', 'Number', 'Expiry', 'Status']} minWidth={520}>
            {d.documents.map((doc) => (
              <tr key={doc.id}>
                <td className={`${td} text-ink`}>{DOCUMENT_TYPE_LABEL[doc.type]}</td>
                <td className={`${td} num`}>{doc.numberMasked}</td>
                <td className={td}>{doc.expiryDate ? fmtDate(doc.expiryDate) : '—'}</td>
                <td className={td}>
                  <DocumentStatusBadge status={doc.status} days={doc.daysToExpiry} />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          muted('No documents on file.')
        )}
      </Card>

      <Card
        title="My letters"
        actions={
          <Button size="sm" onClick={() => setLetterOpen(true)}>
            <Plus />
            Request a letter
          </Button>
        }
      >
        {d.letters.length ? (
          <Table label="My letter requests" head={['Letter', 'Addressee', 'Requested', 'Status', '']} minWidth={640}>
            {d.letters.map((l) => (
              <tr key={l.id}>
                <td className={`${td} text-ink`}>
                  {l.typeName}
                  {l.language !== 'en' && <span className="block text-xs text-muted">{LETTER_LANGUAGE_LABEL[l.language]}</span>}
                </td>
                <td className={td}>{l.addressee}</td>
                <td className={td}>{fmtDate(l.createdAt)}</td>
                <td className={td}>
                  <Badge tone={STATUS_TONE[l.status]}>{LETTER_STATUS_LABEL[l.status]}</Badge>
                  {l.rejectionReason && <span className="mt-0.5 block text-xs text-muted">{l.rejectionReason}</span>}
                </td>
                <td className={`${td} text-end`}>
                  {l.status === 'issued' || l.status === 'revoked' ? (
                    <Link to={letterPath(l.id)} className="text-[0.8125rem] font-medium text-accent-700 hover:underline dark:text-accent-300">
                      Open {l.referenceNo}
                    </Link>
                  ) : l.canCancel ? (
                    <Button size="sm" variant="ghost" onClick={() => cancelLetter.mutate({ id: l.id, action: 'cancel' }, { onSuccess: () => toast.success('Request cancelled') })}>
                      Cancel
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          muted('No letter requests yet. Salary certificates, NOCs and employment letters are issued by HR.')
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="My payslips">
          {d.payslips.length ? (
            <ul className="divide-y divide-line text-[0.8125rem]">
              {d.payslips.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <Link to={myPayslipPath(s.id)} className="font-medium text-accent-700 hover:underline dark:text-accent-300">
                    {payMonthLabel(s.month)}
                  </Link>
                  <span className="num text-ink">
                    {s.currency} {fmt2(s.net)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            muted('No paid payslips yet.')
          )}
        </Card>
        <Card title="My assets">
          {d.assets.length ? (
            <ul className="divide-y divide-line text-[0.8125rem]">
              {d.assets.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-ink">
                    {a.name} <span className="text-muted">· {ASSET_CATEGORY_LABEL[a.category]}</span>
                  </span>
                  <span className="num text-muted">
                    {a.tag}
                    {a.assignedDate ? ` · since ${fmtDate(a.assignedDate)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            muted('No company assets assigned to you.')
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="My training and certificates">
          {d.training.enrollments.length || d.training.certificates.length ? (
            <ul className="divide-y divide-line text-[0.8125rem]">
              {d.training.certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-ink">Certificate · {c.courseTitle}</span>
                  <span className="text-muted">
                    {CERTIFICATE_STATE_LABEL[c.state]}
                    {c.expiryDate ? ` · expires ${fmtDate(c.expiryDate)}` : ''}
                  </span>
                </li>
              ))}
              {d.training.enrollments.slice(0, 8).map((en) => (
                <li key={en.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-ink">{en.courseTitle}</span>
                  <span className="text-muted">
                    {fmtDate(en.sessionStart)} · {ENROLLMENT_STATUS_LABEL[en.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            muted('No training yet.')
          )}
        </Card>
        {d.interviews.length > 0 && (
          <Card title="My interviews">
            <ul className="divide-y divide-line text-[0.8125rem]">
              {d.interviews.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-ink">
                    {i.candidateName} <span className="text-muted">· {i.openingTitle}</span>
                  </span>
                  <span className="text-muted">
                    {fmtDate(i.scheduledAt)} · {i.myScorecard ? 'scored' : 'to score'}
                  </span>
                </li>
              ))}
            </ul>
            {d.hrScope !== 'hidden' && (
              <Link to={`${PATHS.hrRecruitment}?tab=my-interviews`} className="mt-2 inline-block text-xs text-accent-700 hover:underline dark:text-accent-300">
                Open in Recruitment
              </Link>
            )}
          </Card>
        )}
      </div>

      {/* SLOTS: cards of other HR sections (onboarding tasks, reviews), see ../portalSlots.tsx */}
      {PORTAL_SLOT_ORDER.map((id) => {
        const Slot = MY_HR_SLOTS[id].component
        return Slot ? (
          <div key={id} data-slot={id}>
            <Suspense fallback={<Skeleton className="h-24" />}>
              <Slot />
            </Suspense>
          </div>
        ) : null
      })}

      {changeOpen && <ProfileChangeModal d={d} onClose={() => setChangeOpen(false)} />}
      {letterOpen && <LetterRequestModal d={d} onClose={() => setLetterOpen(false)} />}
      {leaveOpen && <LeaveRequestForm onClose={() => setLeaveOpen(false)} />}
    </>
  )
}

/** Clock in / out, this month's attendance, and the leave balances (Attendance / Leave self-service). */
function TimeCards({ onRequestLeave }: { onRequestLeave: () => void }) {
  const att = useMyAttendance()
  const leave = useMyLeave()
  return (
    <>
      <div className="space-y-3">
        {att.data ? <ClockCard data={att.data} compact /> : att.error ? <ErrorState message={errorMessage(att.error)} onRetry={() => att.refetch()} /> : <Skeleton className="h-28" />}
        {att.data && (
          <section aria-label="Attendance this month" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Present" value={att.data.summary.present} />
            <Metric label="Late" value={att.data.summary.late} tone={att.data.summary.late ? 'warning' : undefined} />
            <Metric label="Absent" value={att.data.summary.absent} tone={att.data.summary.absent ? 'danger' : undefined} />
            <Metric label="Worked" value={fmtMinutes(att.data.summary.minutesWorked)} />
          </section>
        )}
        <Link to={`${PATHS.hrAttendance}?tab=me`} className="inline-block text-xs text-accent-700 hover:underline dark:text-accent-300">
          My attendance and corrections
        </Link>
      </div>
      <Card
        title="Leave balance"
        actions={
          <Button size="sm" variant="secondary" onClick={onRequestLeave}>
            <Plane />
            Request leave
          </Button>
        }
      >
        {leave.data ? (
          <ul className="divide-y divide-line text-[0.8125rem]" aria-label="Leave balances">
            {leave.data.balances
              .filter((b) => b.accruedDays > 0 || b.usedDays > 0 || ['annual', 'sick'].includes(b.code))
              .map((b) => (
                <li key={b.leaveTypeId} className="flex items-center justify-between py-1.5">
                  <span className="text-ink">{b.leaveTypeName}</span>
                  <span className="num text-muted">
                    <span className="font-semibold text-ink">{b.remainingDays}</span> left · {b.usedDays} taken · {b.pendingDays} pending
                  </span>
                </li>
              ))}
          </ul>
        ) : leave.error ? (
          <ErrorState message={errorMessage(leave.error)} onRetry={() => leave.refetch()} />
        ) : (
          <Skeleton className="h-28" />
        )}
        <Link to={`${PATHS.hrLeave}?tab=me`} className="mt-2 inline-block text-xs text-accent-700 hover:underline dark:text-accent-300">
          My leave requests
        </Link>
      </Card>
    </>
  )
}

function ProfileChangeModal({ d, onClose }: { d: MyHr; onClose: () => void }) {
  const toast = useToast()
  const p = d.profile
  const [f, setF] = useState({
    mobile: p.mobile,
    ecName: p.emergencyContact.name,
    ecRelation: p.emergencyContact.relation,
    ecPhone: p.emergencyContact.phone,
    line1: p.address.line1,
    city: p.address.city,
    country: p.address.country,
    bankName: p.bank.bankName,
    accountName: p.bank.accountName,
    iban: '',
    note: '',
  })
  const submit = useSelfServiceMutation(selfServiceApi.submitProfileChange)
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }))
  function send() {
    const input: ProfileChangeInput = { note: f.note }
    if (f.mobile !== p.mobile) input.mobile = f.mobile
    if (f.ecName !== p.emergencyContact.name || f.ecRelation !== p.emergencyContact.relation || f.ecPhone !== p.emergencyContact.phone) input.emergencyContact = { name: f.ecName, relation: f.ecRelation, phone: f.ecPhone }
    if (f.line1 !== p.address.line1 || f.city !== p.address.city || f.country !== p.address.country) input.address = { line1: f.line1, city: f.city, country: f.country }
    if (f.iban.trim() || f.bankName !== p.bank.bankName || f.accountName !== p.bank.accountName) input.bank = { bankName: f.bankName, accountName: f.accountName, ...(f.iban.trim() ? { iban: f.iban } : {}) }
    submit.mutate(input, {
      onSuccess: () => {
        toast.success('Sent to HR', 'You’ll get a notification when HR decides.')
        onClose()
      },
    })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Request a profile change"
      description="HR reviews every change before it’s applied. A new bank account is checked by HR before your salary goes there."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} loading={submit.isPending}>
            Send to HR
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Mobile">
          <TextInput value={f.mobile} onChange={set('mobile')} inputMode="tel" />
        </F>
        <div />
        <F label="Emergency contact name">
          <TextInput value={f.ecName} onChange={set('ecName')} />
        </F>
        <F label="Relation">
          <TextInput value={f.ecRelation} onChange={set('ecRelation')} />
        </F>
        <F label="Emergency contact phone">
          <TextInput value={f.ecPhone} onChange={set('ecPhone')} inputMode="tel" />
        </F>
        <div />
        <F label="Address">
          <TextInput value={f.line1} onChange={set('line1')} />
        </F>
        <F label="City">
          <TextInput value={f.city} onChange={set('city')} />
        </F>
        <F label="Country code" hint="2 letters, e.g. AE">
          <TextInput value={f.country} onChange={set('country')} maxLength={2} />
        </F>
        <div />
        <F label="Bank name">
          <TextInput value={f.bankName} onChange={set('bankName')} />
        </F>
        <F label="Account name">
          <TextInput value={f.accountName} onChange={set('accountName')} />
        </F>
        <F label="New IBAN" hint={p.bank.ibanMasked ? `Current: ${p.bank.ibanMasked}. Leave empty to keep it.` : 'Leave empty if unchanged.'}>
          <TextInput value={f.iban} onChange={set('iban')} autoComplete="off" />
        </F>
        <div className="sm:col-span-2">
          <F label="Note for HR">
            <TextArea value={f.note} onChange={set('note')} rows={2} />
          </F>
        </div>
      </div>
      {submit.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(submit.error)}</p>}
    </Modal>
  )
}

function LetterRequestModal({ d, onClose }: { d: MyHr; onClose: () => void }) {
  const toast = useToast()
  const types = d.letterTypes
  const [typeId, setTypeId] = useState(types.find((t) => t.available)?.id ?? '')
  const [addressee, setAddressee] = useState('')
  const [purpose, setPurpose] = useState('')
  const [noc, setNoc] = useState<NocPurpose>('travel')
  const [languageNote, setLanguageNote] = useState('')
  const [language, setLanguage] = useState<LetterLanguage>('en')
  const [layout, setLayout] = useState<BilingualLayout>('side_by_side')
  const [digits, setDigits] = useState<DigitStyle>('western')
  const [addresseeAr, setAddresseeAr] = useState('')
  const [purposeAr, setPurposeAr] = useState('')
  const t = types.find((x) => x.id === typeId)
  const arabic = language !== 'en'
  const submit = useSelfServiceMutation(selfServiceApi.requestLetter)
  function send() {
    submit.mutate(
      {
        letterTypeId: typeId,
        addressee,
        purpose,
        nocPurpose: t?.code === 'noc' ? noc : null,
        languageNote,
        language,
        layout: language === 'bilingual' ? layout : null,
        digits,
        ...(arabic ? { addresseeAr, purposeAr } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Letter requested', 'HR will issue it or tell you why not.')
          onClose()
        },
      },
    )
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Request a letter"
      description="HR approves every letter. Salary letters show your pay; the others don’t."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} loading={submit.isPending} disabled={!t?.available}>
            <Mail />
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <F label="Letter">
          <SelectInput value={typeId} onChange={(ev) => setTypeId(ev.target.value)}>
            {types.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.available}>
                {x.name}
                {x.available ? '' : ' (not available)'}
              </option>
            ))}
          </SelectInput>
        </F>
        {t && <p className="text-xs text-muted">{t.available ? t.description : t.unavailableReason}</p>}
        <F label="Addressee" hint={t?.code === 'salary_transfer' ? 'The bank, e.g. Emirates NBD' : 'Leave empty for “To whom it may concern”.'}>
          <TextInput value={addressee} onChange={(ev) => setAddressee(ev.target.value)} />
        </F>
        {t?.code === 'noc' && (
          <F label="NOC for">
            <SelectInput value={noc} onChange={(ev) => setNoc(ev.target.value as NocPurpose)}>
              {NOC_PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {NOC_PURPOSE_LABEL[x]}
                </option>
              ))}
            </SelectInput>
          </F>
        )}
        <F label="Purpose" hint="e.g. a car loan application, travel to Oman from 10 to 14 March">
          <TextInput value={purpose} onChange={(ev) => setPurpose(ev.target.value)} />
        </F>
        <F label="Language" hint={t && !t.hasArabic ? 'This letter has no Arabic version yet.' : 'Arabic letters use your name and job title in Arabic from your HR record.'}>
          <SelectInput value={language} onChange={(ev) => setLanguage(ev.target.value as LetterLanguage)}>
            {LETTER_LANGUAGES.map((x) => (
              <option key={x} value={x} disabled={x !== 'en' && !!t && !t.hasArabic}>
                {LETTER_LANGUAGE_LABEL[x]}
              </option>
            ))}
          </SelectInput>
        </F>
        {language === 'bilingual' && (
          <F label="Bilingual layout">
            <SelectInput value={layout} onChange={(ev) => setLayout(ev.target.value as BilingualLayout)}>
              {BILINGUAL_LAYOUTS.map((x) => (
                <option key={x} value={x}>
                  {BILINGUAL_LAYOUT_LABEL[x]}
                </option>
              ))}
            </SelectInput>
          </F>
        )}
        {arabic && (
          <>
            <F label="Digits in the Arabic text">
              <SelectInput value={digits} onChange={(ev) => setDigits(ev.target.value as DigitStyle)}>
                {(['western', 'arabic'] as const).map((x) => (
                  <option key={x} value={x}>
                    {DIGIT_STYLE_LABEL[x]}
                  </option>
                ))}
              </SelectInput>
            </F>
            <F label="Addressee in Arabic" hint="Optional; otherwise the addressee above, or «لمن يهمه الأمر».">
              <TextInput dir="rtl" lang="ar" value={addresseeAr} onChange={(ev) => setAddresseeAr(ev.target.value)} />
            </F>
            <F label="Purpose in Arabic" hint="Optional">
              <TextInput dir="rtl" lang="ar" value={purposeAr} onChange={(ev) => setPurposeAr(ev.target.value)} />
            </F>
          </>
        )}
        <F label="Note to HR" hint="Optional">
          <TextInput value={languageNote} onChange={(ev) => setLanguageNote(ev.target.value)} />
        </F>
      </div>
      {submit.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(submit.error)}</p>}
    </Modal>
  )
}

