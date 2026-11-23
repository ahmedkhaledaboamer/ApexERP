import { useEffect, useState, type FormEvent } from 'react'
import type { EmploymentStatus, EmploymentType, Gender } from '@/modules/hr/types'
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import type { EmployeeDetail, EmployeeInput } from '@/modules/hr/peopleTypes'
import { useEmployeesQuery, useSaveEmployee } from '@/modules/hr/hooks/useHrPeople'
import { useDepartmentsQuery } from '@/modules/settings/hooks/useSettingsUsers'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { COUNTRIES, FormError, Section } from './PeopleBits'

interface Draft {
  fullName: string
  jobTitle: string
  fullNameAr: string
  jobTitleAr: string
  departmentId: string
  managerId: string
  email: string
  mobile: string
  nationality: string
  gender: '' | Gender
  dateOfBirth: string
  hireDate: string
  employmentType: EmploymentType
  status: EmploymentStatus
  exitDate: string
  ecName: string
  ecRelation: string
  ecPhone: string
  addrLine: string
  addrCity: string
  addrCountry: string
  bankName: string
  accountName: string
  iban: string
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const draftOf = (e: EmployeeDetail | null): Draft => ({
  fullName: e?.fullName ?? '',
  jobTitle: e?.jobTitle ?? '',
  fullNameAr: e?.fullNameAr ?? '',
  jobTitleAr: e?.jobTitleAr ?? '',
  departmentId: e?.departmentId ?? '',
  managerId: e?.managerId ?? '',
  email: e?.email ?? '',
  mobile: e?.mobile ?? '',
  nationality: e?.nationality ?? 'AE',
  gender: e?.gender ?? '',
  dateOfBirth: e?.dateOfBirth ?? '',
  hireDate: e?.hireDate ?? todayIso(),
  employmentType: e?.employmentType ?? 'full_time',
  status: e?.status ?? 'active',
  exitDate: e?.exitDate ?? '',
  ecName: e?.emergencyContact.name ?? '',
  ecRelation: e?.emergencyContact.relation ?? '',
  ecPhone: e?.emergencyContact.phone ?? '',
  addrLine: e?.address.line1 ?? '',
  addrCity: e?.address.city ?? '',
  addrCountry: e?.address.country ?? '',
  bankName: e?.bank?.bankName ?? '',
  accountName: e?.bank?.accountName ?? '',
  iban: '',
})

/** Create / edit an employee (HR full). Creating never creates a login; the IBAN is write-only (blank keeps it). */
export function EmployeeDrawer({ open, onClose, employee, onSaved }: { open: boolean; onClose: () => void; employee: EmployeeDetail | null; onSaved?: (e: EmployeeDetail) => void }) {
  const save = useSaveEmployee()
  const toast = useToast()
  const depts = useDepartmentsQuery()
  const people = useEmployeesQuery(open)
  const [d, setD] = useState<Draft>(() => draftOf(employee))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setD(draftOf(employee))
    setTouched(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const leaving = d.status === 'notice' || d.status === 'terminated'
  const errs: Partial<Record<keyof Draft, string>> = {}
  if (touched) {
    if (d.fullName.trim().length < 2) errs.fullName = 'Enter the full name.'
    if (!d.jobTitle.trim()) errs.jobTitle = 'Enter the job title.'
    if (!d.hireDate) errs.hireDate = 'Enter the hire date.'
    if (leaving && !d.exitDate) errs.exitDate = 'Set the last working day.'
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    if (d.fullName.trim().length < 2 || !d.jobTitle.trim() || !d.hireDate || (leaving && !d.exitDate)) return
    const input: Partial<EmployeeInput> = {
      fullName: d.fullName,
      jobTitle: d.jobTitle,
      fullNameAr: d.fullNameAr,
      jobTitleAr: d.jobTitleAr,
      departmentId: d.departmentId || null,
      managerId: d.managerId || null,
      email: d.email,
      mobile: d.mobile,
      nationality: d.nationality,
      gender: d.gender || null,
      dateOfBirth: d.dateOfBirth || null,
      hireDate: d.hireDate,
      employmentType: d.employmentType,
      status: d.status,
      exitDate: leaving ? d.exitDate : null,
      emergencyContact: { name: d.ecName, relation: d.ecRelation, phone: d.ecPhone },
      address: { line1: d.addrLine, city: d.addrCity, country: d.addrCountry },
      bank: { bankName: d.bankName, accountName: d.accountName, ...(d.iban.trim() ? { iban: d.iban } : {}) },
    }
    save.mutate(
      { id: employee?.id, input },
      {
        onSuccess: (e) => {
          toast.success(employee ? 'Employee saved' : 'Employee added', `${e.fullName} · ${e.employeeNo}`)
          onSaved?.(e)
          onClose()
        },
      },
    )
  }

  const managers = (people.data ?? []).filter((p) => p.id !== employee?.id && p.status !== 'terminated')

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={employee ? `Edit ${employee.fullName}` : 'New employee'}
      description={employee ? `${employee.employeeNo}` : 'Adds an HR record. No login is created; invite them as a user from the profile if they need one.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="employee-form" loading={save.isPending}>
            {employee ? 'Save employee' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" noValidate onSubmit={submit} className="space-y-6">
        <Section title="Job">
          <Field id="emp-name" label="Full name" required error={errs.fullName}>
            <TextInput id="emp-name" value={d.fullName} invalid={!!errs.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="emp-name-ar" label="Name in Arabic" hint="Optional; used by Arabic and bilingual HR letters.">
              <TextInput id="emp-name-ar" dir="rtl" lang="ar" value={d.fullNameAr} onChange={(e) => set('fullNameAr', e.target.value)} />
            </Field>
            <Field id="emp-title-ar" label="Job title in Arabic" hint="Optional">
              <TextInput id="emp-title-ar" dir="rtl" lang="ar" value={d.jobTitleAr} onChange={(e) => set('jobTitleAr', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="emp-title" label="Job title" required error={errs.jobTitle}>
              <TextInput id="emp-title" value={d.jobTitle} invalid={!!errs.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
            </Field>
            <Field id="emp-dept" label="Department">
              <SelectInput id="emp-dept" value={d.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                <option value="">No department</option>
                {(depts.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </SelectInput>
            </Field>
            <Field id="emp-manager" label="Manager">
              <SelectInput id="emp-manager" value={d.managerId} onChange={(e) => set('managerId', e.target.value)}>
                <option value="">No manager</option>
                {managers.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName} · {p.jobTitle}</option>
                ))}
              </SelectInput>
            </Field>
            <Field id="emp-type" label="Employment type">
              <SelectInput id="emp-type" value={d.employmentType} onChange={(e) => set('employmentType', e.target.value as EmploymentType)}>
                {(Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((t) => (
                  <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>
                ))}
              </SelectInput>
            </Field>
            <Field id="emp-hire" label="Hire date" required error={errs.hireDate}>
              <TextInput id="emp-hire" type="date" value={d.hireDate} invalid={!!errs.hireDate} onChange={(e) => set('hireDate', e.target.value)} />
            </Field>
            <Field id="emp-status" label="Status">
              <SelectInput id="emp-status" value={d.status} onChange={(e) => set('status', e.target.value as EmploymentStatus)}>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{EMPLOYMENT_STATUS_LABEL[s]}</option>
                ))}
              </SelectInput>
            </Field>
            {leaving && (
              <Field id="emp-exit" label="Exit date (last working day)" required error={errs.exitDate} hint="Starts the offboarding checklist.">
                <TextInput id="emp-exit" type="date" value={d.exitDate} invalid={!!errs.exitDate} onChange={(e) => set('exitDate', e.target.value)} />
              </Field>
            )}
          </div>
        </Section>
        <Section title="Personal">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="emp-email" label="Email">
              <TextInput id="emp-email" type="email" value={d.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field id="emp-mobile" label="Mobile">
              <TextInput id="emp-mobile" inputMode="tel" value={d.mobile} onChange={(e) => set('mobile', e.target.value)} />
            </Field>
            <Field id="emp-nat" label="Nationality">
              <SelectInput id="emp-nat" value={d.nationality} onChange={(e) => set('nationality', e.target.value)}>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </SelectInput>
            </Field>
            <Field id="emp-gender" label="Gender">
              <SelectInput id="emp-gender" value={d.gender} onChange={(e) => set('gender', e.target.value as Draft['gender'])}>
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </SelectInput>
            </Field>
            <Field id="emp-dob" label="Date of birth">
              <TextInput id="emp-dob" type="date" value={d.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title="Emergency contact">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="emp-ec-name" label="Name">
              <TextInput id="emp-ec-name" value={d.ecName} onChange={(e) => set('ecName', e.target.value)} />
            </Field>
            <Field id="emp-ec-rel" label="Relation">
              <TextInput id="emp-ec-rel" value={d.ecRelation} onChange={(e) => set('ecRelation', e.target.value)} />
            </Field>
            <Field id="emp-ec-phone" label="Phone">
              <TextInput id="emp-ec-phone" inputMode="tel" value={d.ecPhone} onChange={(e) => set('ecPhone', e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title="Address">
          <Field id="emp-addr" label="Address line">
            <TextInput id="emp-addr" value={d.addrLine} onChange={(e) => set('addrLine', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="emp-city" label="City">
              <TextInput id="emp-city" value={d.addrCity} onChange={(e) => set('addrCity', e.target.value)} />
            </Field>
            <Field id="emp-country" label="Country code" hint="2 letters, e.g. AE">
              <TextInput id="emp-country" maxLength={2} value={d.addrCountry} onChange={(e) => set('addrCountry', e.target.value.toUpperCase())} />
            </Field>
          </div>
        </Section>
        <Section title="Bank details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="emp-bank" label="Bank">
              <TextInput id="emp-bank" value={d.bankName} onChange={(e) => set('bankName', e.target.value)} />
            </Field>
            <Field id="emp-acc" label="Account name">
              <TextInput id="emp-acc" value={d.accountName} onChange={(e) => set('accountName', e.target.value)} />
            </Field>
          </div>
          <Field id="emp-iban" label="IBAN" hint={employee?.bank?.ibanMasked ? `Stored: ${employee.bank.ibanMasked}. Leave blank to keep it.` : 'Stored securely; shown masked.'}>
            <TextInput id="emp-iban" autoComplete="off" value={d.iban} placeholder="AE07 0331 2345 6789 0123 456" onChange={(e) => set('iban', e.target.value)} />
          </Field>
        </Section>
        <FormError error={save.error} />
      </form>
    </Drawer>
  )
}
