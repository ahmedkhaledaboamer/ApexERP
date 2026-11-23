import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileCheck2, Plus } from 'lucide-react'
import type { Role } from '@/shared/types'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import type { HrFile } from '@/modules/hr/peopleTypes'
import { FileInput } from '@/modules/hr/components/PeopleBits'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { errorMessage, F, Table, td, useHrScope } from '@/modules/hr/time/components/shared'
import { complianceApi, useComplianceMutation, usePolicies } from '../api'
import { POLICY_CATEGORIES, POLICY_CATEGORY_LABEL, type AudienceKind, type PolicyAudience, type PolicyCategory, type PolicyDetail } from '../types'
import { AckBar, PolicyStatusBadge, policyPath } from '../components/bits'

/**
 * `/hr/policies`: company policies employees must acknowledge. HR full writes (draft → publish a version; a new version
 * needs everyone to re-acknowledge); a department head sees the published ones with their team's numbers.
 */
export default function PoliciesPage() {
  const { full } = useHrScope()
  const q = usePolicies()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <FileCheck2 />
          </IconTile>
        }
        title="Policies"
        description="Publish company policies and track who has read and acknowledged the current version. Employees acknowledge in My HR; reminders go out at publish, after 3 and after 7 days."
        actions={
          full ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New policy
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-4">
        {q.isPending ? (
          <Skeleton className="h-64" />
        ) : q.error ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState title="No policies yet" body={full ? 'Create a policy, then publish it to the employees it applies to.' : 'Nothing published yet.'} icon={<FileCheck2 />} />
        ) : (
          <Table label="Policies" head={['Policy', 'Status', 'Version', 'Audience', full ? 'Acknowledged' : 'Your team', '']} minWidth={900}>
            {q.data.map((p) => (
              <tr key={p.id}>
                <td className={`${td} text-ink`}>
                  <Link to={policyPath(p.id)} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <span className="block text-xs text-muted">{POLICY_CATEGORY_LABEL[p.category]}</span>
                </td>
                <td className={td}>
                  <PolicyStatusBadge status={p.status} />
                  {p.hasDraft && p.status !== 'draft' && <span className="block text-xs text-muted">unpublished changes</span>}
                </td>
                <td className={td}>
                  {p.version ? `v${p.version}` : '—'}
                  {p.effectiveDate && <span className="block text-xs text-muted">effective {fmtDate(p.effectiveDate)}</span>}
                </td>
                <td className={td}>{p.audienceLabel}</td>
                <td className={td}>
                  {p.status === 'published' ? (
                    <>
                      <AckBar pct={p.stats.pct} label={p.title} />
                      <span className="text-xs text-muted">
                        {p.stats.acknowledged} of {p.stats.audience}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${td} text-end`}>
                  <Button size="sm" variant="ghost" onClick={() => navigate(policyPath(p.id))}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </PageBody>
      {creating && <PolicyEditor onClose={() => setCreating(false)} onSaved={(p) => navigate(policyPath(p.id))} />}
    </>
  )
}

const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

/** Create a policy, or edit one (title, category, audience apply now; text / PDF / effective date go into the next version). */
export function PolicyEditor({ policy, onClose, onSaved }: { policy?: PolicyDetail; onClose: () => void; onSaved?: (p: PolicyDetail) => void }) {
  const toast = useToast()
  const depts = useDepartmentsQuery()
  const base = policy?.draft ?? policy?.current ?? null
  const [title, setTitle] = useState(policy?.title ?? '')
  const [category, setCategory] = useState<PolicyCategory>(policy?.category ?? 'code_of_conduct')
  const [kind, setKind] = useState<AudienceKind>(policy?.audience.kind ?? 'all')
  const [departmentIds, setDepartmentIds] = useState<string[]>(policy?.audience.departmentIds ?? [])
  const [roles, setRoles] = useState<Role[]>(policy?.audience.roles ?? [])
  const [effectiveDate, setEffectiveDate] = useState(base?.effectiveDate ?? new Date().toISOString().slice(0, 10))
  const [body, setBody] = useState(base?.body ?? '')
  const [file, setFile] = useState<HrFile | null>(base?.file ?? null)
  const [changeNote, setChangeNote] = useState(policy?.draft?.changeNote ?? '')
  const create = useComplianceMutation(complianceApi.createPolicy)
  const update = useComplianceMutation(complianceApi.updatePolicy)
  const m = policy ? update : create
  const audience: PolicyAudience = { kind, departmentIds: kind === 'departments' ? departmentIds : [], roles: kind === 'roles' ? roles : [] }
  function save() {
    // Only a real change of the text / PDF / date opens the next version's draft.
    const textChanged = !policy || body !== (base?.body ?? '') || (file?.name ?? '') !== (base?.file?.name ?? '') || effectiveDate !== base?.effectiveDate || changeNote !== (policy.draft?.changeNote ?? '')
    const input = { title, category, audience, ...(textChanged ? { body, file, effectiveDate, changeNote } : {}) }
    const done = {
      onSuccess: (p: PolicyDetail) => {
        toast.success(policy ? 'Policy saved' : 'Policy created', p.hasDraft && p.status !== 'draft' ? 'Publish it to make this the new version.' : 'Publish it when it’s ready.')
        onClose()
        onSaved?.(p)
      },
    }
    if (policy) update.mutate({ id: policy.id, input }, done)
    else create.mutate(input, done)
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <Drawer
      open
      onClose={onClose}
      title={policy ? `Edit ${policy.title}` : 'New policy'}
      description={policy?.version ? 'Text, PDF and effective date changes become the next version when you publish; everyone in the audience then acknowledges again.' : 'Saved as a draft; publish it to send it to employees.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={m.isPending} disabled={title.trim().length < 3}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <F label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Category">
            <SelectInput value={category} onChange={(e) => setCategory(e.target.value as PolicyCategory)}>
              {POLICY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {POLICY_CATEGORY_LABEL[c]}
                </option>
              ))}
            </SelectInput>
          </F>
          <F label="Effective date">
            <TextInput type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </F>
        </div>
        <F label="Audience">
          <SelectInput value={kind} onChange={(e) => setKind(e.target.value as AudienceKind)}>
            <option value="all">All employees</option>
            <option value="departments">Departments</option>
            <option value="roles">Roles</option>
          </SelectInput>
        </F>
        {kind === 'departments' && (
          <fieldset className="grid grid-cols-2 gap-1 rounded-lg border border-line p-2 text-[0.8125rem]">
            <legend className="px-1 text-xs text-muted">Departments (and their sub-departments)</legend>
            {(depts.data ?? []).map((d) => (
              <label key={d.id} className="flex items-center gap-2">
                <Checkbox checked={departmentIds.includes(d.id)} onChange={() => setDepartmentIds(toggle(departmentIds, d.id))} />
                {d.name}
              </label>
            ))}
          </fieldset>
        )}
        {kind === 'roles' && (
          <fieldset className="grid grid-cols-2 gap-1 rounded-lg border border-line p-2 text-[0.8125rem]">
            <legend className="px-1 text-xs text-muted">Roles</legend>
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2">
                <Checkbox checked={roles.includes(r)} onChange={() => setRoles(toggle(roles, r))} />
                {r}
              </label>
            ))}
          </fieldset>
        )}
        <F label="Policy text" hint="Formatting: “# ” starts a heading, “- ” a bullet, **bold**. Or upload the PDF below (or both).">
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
        </F>
        <F label="PDF" hint="Optional; counts against the plan’s storage.">
          <FileInput id="" value={file} onChange={setFile} />
        </F>
        {policy?.version ? (
          <F label="What changed" hint="Shown to employees with the new version.">
            <TextInput value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
          </F>
        ) : null}
        {m.error && <p className="text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
      </div>
    </Drawer>
  )
}
