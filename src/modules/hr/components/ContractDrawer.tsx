import { useEffect, useState, type FormEvent } from 'react'
import type { ContractInput, ContractStatus, ContractType, EmployeeContract, HrFile } from '@/modules/hr/peopleTypes'
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPES, CONTRACT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { useEmployeesQuery, useRenewContract, useSaveContract } from '@/modules/hr/hooks/useHrPeople'
import { useRegion } from '@/modules/tenancy/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { FileInput, FormError, Section } from './PeopleBits'

interface Draft {
  employeeId: string
  type: ContractType
  startDate: string
  endDate: string
  probationMonths: string
  noticeDays: string
  hoursPerWeek: string
  basicSalary: string
  housingAllowance: string
  transportAllowance: string
  otherAllowance: string
  currency: string
  status: ContractStatus
  signedDate: string
  file: HrFile | null
  notes: string
}

const n = (v: number | null | undefined, d = '') => (v === null || v === undefined ? d : String(v))

function draftOf(c: EmployeeContract | null, employeeId: string, currency: string, renew: boolean): Draft {
  const nextStart = c?.endDate ? new Date(Date.parse(c.endDate) + 86_400_000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  return {
    employeeId: c?.employeeId ?? employeeId,
    type: c?.type ?? 'unlimited',
    startDate: renew ? nextStart : c?.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: renew ? '' : c?.endDate ?? '',
    probationMonths: renew ? '0' : n(c?.probationMonths, '6'),
    noticeDays: n(c?.noticeDays, '30'),
    hoursPerWeek: n(c?.hoursPerWeek, '48'),
    basicSalary: n(c?.basicSalary),
    housingAllowance: n(c?.housingAllowance, '0'),
    transportAllowance: n(c?.transportAllowance, '0'),
    otherAllowance: n(c?.otherAllowance, '0'),
    currency: c?.currency ?? currency,
    status: renew ? 'active' : c?.status ?? 'draft',
    signedDate: renew ? new Date().toISOString().slice(0, 10) : c?.signedDate ?? '',
    file: renew ? null : c?.file ?? null,
    notes: renew ? '' : c?.notes ?? '',
  }
}

/**
 * New / edit / renew a contract (HR full). Renewing posts the new terms to /renew: the old contract becomes
 * `renewed` and the new one `active`. Only one active contract per employee (the API refuses a second).
 */
export function ContractDrawer({
  open,
  onClose,
  contract,
  mode,
  employeeId = '',
}: {
  open: boolean
  onClose: () => void
  contract: EmployeeContract | null
  mode: 'create' | 'edit' | 'renew'
  employeeId?: string
}) {
  const region = useRegion()
  const save = useSaveContract()
  const renew = useRenewContract()
  const toast = useToast()
  const people = useEmployeesQuery(open && mode === 'create' && !employeeId)
  const [d, setD] = useState<Draft>(() => draftOf(contract, employeeId, region.currency, mode === 'renew'))
  useEffect(() => {
    if (!open) return
    setD(draftOf(contract, employeeId, region.currency, mode === 'renew'))
    save.reset()
    renew.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract?.id, mode])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const busy = save.isPending || renew.isPending
  const error = save.error ?? renew.error

  function submit(ev: FormEvent) {
    ev.preventDefault()
    const input: Partial<ContractInput> = {
      type: d.type,
      startDate: d.startDate,
      // Renew with a blank end date: the API keeps the old contract's length.
      endDate: d.endDate || (mode === 'renew' ? undefined : null),
      probationMonths: Number(d.probationMonths || 0),
      noticeDays: Number(d.noticeDays || 0),
      hoursPerWeek: Number(d.hoursPerWeek || 0),
      basicSalary: Number(d.basicSalary || 0),
      housingAllowance: Number(d.housingAllowance || 0),
      transportAllowance: Number(d.transportAllowance || 0),
      otherAllowance: Number(d.otherAllowance || 0),
      currency: d.currency,
      signedDate: d.signedDate || null,
      file: d.file,
      notes: d.notes,
    }
    const done = (c: EmployeeContract) => {
      toast.success(mode === 'renew' ? 'Contract renewed' : mode === 'edit' ? 'Contract saved' : 'Contract added', `${c.employeeName} · ${CONTRACT_TYPE_LABEL[c.type]}`)
      onClose()
    }
    if (mode === 'renew' && contract) renew.mutate({ id: contract.id, input }, { onSuccess: done })
    else save.mutate({ id: mode === 'edit' ? contract?.id : undefined, input: { ...input, employeeId: d.employeeId, status: d.status } }, { onSuccess: done })
  }

  const statuses: ContractStatus[] = mode === 'create' ? ['draft', 'active'] : contract?.status === 'draft' ? ['draft', 'active'] : contract?.status === 'active' ? ['active', 'ended', 'terminated'] : [contract?.status ?? 'draft']
  const title = mode === 'renew' ? `Renew contract · ${contract?.employeeName ?? ''}` : mode === 'edit' ? `Edit contract · ${contract?.employeeName ?? ''}` : 'New contract'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={title}
      description={mode === 'renew' ? 'Creates a new active contract from these terms; the current one is kept as renewed.' : 'Pay is visible to HR and the employee only.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write type="submit" form="contract-form" loading={busy}>
            {mode === 'renew' ? 'Renew contract' : mode === 'edit' ? 'Save contract' : 'Add contract'}
          </Button>
        </>
      }
    >
      <form id="contract-form" noValidate onSubmit={submit} className="space-y-6">
        <Section title="Terms">
          {mode === 'create' && !employeeId && (
            <Field id="ct-emp" label="Employee" required>
              <SelectInput id="ct-emp" value={d.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">Pick an employee</option>
                {(people.data ?? []).filter((p) => p.status !== 'terminated').map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName} · {p.employeeNo}</option>
                ))}
              </SelectInput>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="ct-type" label="Contract type">
              <SelectInput id="ct-type" value={d.type} onChange={(e) => set('type', e.target.value as ContractType)}>
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>{CONTRACT_TYPE_LABEL[t]}</option>
                ))}
              </SelectInput>
            </Field>
            {mode !== 'renew' && (
              <Field id="ct-status" label="Status">
                <SelectInput id="ct-status" value={d.status} onChange={(e) => set('status', e.target.value as ContractStatus)}>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>
                  ))}
                </SelectInput>
              </Field>
            )}
            <Field id="ct-start" label="Start date" required>
              <TextInput id="ct-start" type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field id="ct-end" label={d.type === 'limited' ? 'End date (required)' : 'End date'} hint={mode === 'renew' ? 'Blank keeps the same length as before.' : undefined}>
              <TextInput id="ct-end" type="date" value={d.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
            <Field id="ct-prob" label="Probation (months)">
              <TextInput id="ct-prob" inputMode="numeric" value={d.probationMonths} onChange={(e) => set('probationMonths', e.target.value)} />
            </Field>
            <Field id="ct-notice" label="Notice period (days)">
              <TextInput id="ct-notice" inputMode="numeric" value={d.noticeDays} onChange={(e) => set('noticeDays', e.target.value)} />
            </Field>
            <Field id="ct-hours" label="Working hours / week">
              <TextInput id="ct-hours" inputMode="numeric" value={d.hoursPerWeek} onChange={(e) => set('hoursPerWeek', e.target.value)} />
            </Field>
            <Field id="ct-signed" label="Signed date">
              <TextInput id="ct-signed" type="date" value={d.signedDate} onChange={(e) => set('signedDate', e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title="Pay (monthly)">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="ct-basic" label="Basic salary">
              <TextInput id="ct-basic" inputMode="decimal" value={d.basicSalary} onChange={(e) => set('basicSalary', e.target.value)} />
            </Field>
            <Field id="ct-housing" label="Housing allowance">
              <TextInput id="ct-housing" inputMode="decimal" value={d.housingAllowance} onChange={(e) => set('housingAllowance', e.target.value)} />
            </Field>
            <Field id="ct-transport" label="Transport allowance">
              <TextInput id="ct-transport" inputMode="decimal" value={d.transportAllowance} onChange={(e) => set('transportAllowance', e.target.value)} />
            </Field>
            <Field id="ct-other" label="Other allowances">
              <TextInput id="ct-other" inputMode="decimal" value={d.otherAllowance} onChange={(e) => set('otherAllowance', e.target.value)} />
            </Field>
            <Field id="ct-currency" label="Currency">
              <SelectInput id="ct-currency" value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                {[...new Set([d.currency, 'AED', 'SAR', 'USD', 'EUR', 'GBP'])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
        </Section>
        <Field id="ct-file" label="Signed contract file">
          <FileInput id="ct-file" value={d.file} onChange={(f) => set('file', f)} />
        </Field>
        <Field id="ct-notes" label="Notes">
          <TextArea id="ct-notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <FormError error={error} />
      </form>
    </Drawer>
  )
}
