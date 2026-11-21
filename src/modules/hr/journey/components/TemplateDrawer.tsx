import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '@/modules/hr/types'
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useDeleteJourneyTemplate, useJourneyOptionsQuery, useSaveJourneyTemplate } from '../hooks'
import { ITEM_ACTION_KINDS, ITEM_ACTION_LABEL, OWNER_ROLES, OWNER_ROLE_LABEL, type ItemActionKind, type JourneyKind, type TemplateItemInput, type TemplateView } from '../types'

type Row = TemplateItemInput & { id?: string }

/** Create / edit a checklist template (HR full). */
export function TemplateDrawer({ template, onClose }: { template: TemplateView | null; onClose: () => void }) {
  const toast = useToast()
  const opts = useJourneyOptionsQuery(true)
  const save = useSaveJourneyTemplate()
  const del = useDeleteJourneyTemplate()
  const [kind, setKind] = useState<JourneyKind>(template?.kind ?? 'onboarding')
  const [name, setName] = useState(template?.name ?? '')
  const [departmentId, setDepartmentId] = useState(template?.departmentId ?? '')
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(template?.employmentType ?? '')
  const [active, setActive] = useState(template?.active ?? true)
  const [rows, setRows] = useState<Row[]>(template?.items.map(({ id, title, description, ownerRole, ownerUserId, dueOffsetDays, dueAnchor, required, action }) => ({ id, title, description, ownerRole, ownerUserId, dueOffsetDays, dueAnchor, required, action })) ?? [{ title: '', ownerRole: 'hr', dueOffsetDays: 0, dueAnchor: 'start', required: true, action: null }])
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const submit = () =>
    save.mutate(
      { id: template?.id, input: { kind, name, departmentId: departmentId || null, employmentType: employmentType || null, active, items: rows } },
      { onSuccess: () => { toast.success('Template saved'); onClose() }, onError: (e) => toast.error('Not saved', e.message) },
    )
  return (
    <Drawer
      open
      onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      description="Due offsets are days from the hire date (onboarding) or the exit date (offboarding); negative = before."
      width="xl"
      footer={
        <>
          {template && (
            <Button write variant="ghost" className="me-auto" loading={del.isPending} onClick={() => del.mutate(template.id, { onSuccess: () => { toast.success('Template deleted'); onClose() }, onError: (e) => toast.error('Not deleted', e.message) })}>
              <Trash2 />Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>Save template</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tpl-name" label="Name" required><TextInput id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="tpl-kind" label="Kind">
            <SelectInput id="tpl-kind" value={kind} disabled={!!template} onChange={(e) => setKind(e.target.value as JourneyKind)}>
              <option value="onboarding">Onboarding</option>
              <option value="offboarding">Offboarding</option>
            </SelectInput>
          </Field>
          <Field id="tpl-dept" label="Department">
            <SelectInput id="tpl-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Any department</option>
              {(opts.data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="tpl-type" label="Employment type">
            <SelectInput id="tpl-type" value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType | '')}>
              <option value="">Any type</option>
              {(Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>)}
            </SelectInput>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[0.8125rem]"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />Active (used for new journeys)</label>
        <ul className="space-y-2" aria-label="Template items">
          {rows.map((r, i) => (
            <li key={r.id ?? `new-${i}`} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-12">
              <TextInput aria-label="Item title" placeholder="Title" value={r.title} onChange={(e) => patch(i, { title: e.target.value })} className="sm:col-span-4" />
              <SelectInput aria-label="Owner" value={r.ownerRole} onChange={(e) => patch(i, { ownerRole: e.target.value as Row['ownerRole'] })} className="sm:col-span-2">
                {OWNER_ROLES.map((o) => <option key={o} value={o}>{OWNER_ROLE_LABEL[o]}</option>)}
              </SelectInput>
              <SelectInput aria-label="Person" value={r.ownerUserId ?? ''} disabled={r.ownerRole === 'employee' || r.ownerRole === 'manager'} onChange={(e) => patch(i, { ownerUserId: e.target.value || null })} className="sm:col-span-2">
                <option value="">{r.ownerRole === 'user' ? 'Pick a person' : 'HR team'}</option>
                {(opts.data?.assignees ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </SelectInput>
              <TextInput aria-label="Due offset (days)" type="number" value={r.dueOffsetDays} onChange={(e) => patch(i, { dueOffsetDays: Number(e.target.value) })} className="sm:col-span-1" />
              <SelectInput aria-label="Counts from" value={r.dueAnchor ?? 'start'} onChange={(e) => patch(i, { dueAnchor: e.target.value as Row['dueAnchor'] })} className="sm:col-span-2">
                <option value="start">{kind === 'onboarding' ? 'Hire date' : 'Exit date'}</option>
                {kind === 'onboarding' && <option value="probation_end">Probation end</option>}
              </SelectInput>
              <Button variant="ghost" size="sm" iconOnly aria-label="Remove item" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="sm:col-span-1"><Trash2 /></Button>
              <SelectInput aria-label="Link action" value={r.action?.kind ?? ''} onChange={(e) => patch(i, { action: e.target.value ? { kind: e.target.value as ItemActionKind } : null })} className="sm:col-span-3">
                <option value="">No link action</option>
                {ITEM_ACTION_KINDS.filter((k) => k !== 'probation_review' || kind === 'onboarding').map((k) => <option key={k} value={k}>{ITEM_ACTION_LABEL[k]}</option>)}
              </SelectInput>
              {r.action?.kind === 'upload_document' && (
                <SelectInput aria-label="Document type" value={r.action.documentType ?? ''} onChange={(e) => patch(i, { action: { kind: 'upload_document', documentType: (e.target.value || null) as never } })} className="sm:col-span-3">
                  <option value="">Pick a type</option>
                  {DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{DOCUMENT_TYPE_LABEL[d]}</option>)}
                </SelectInput>
              )}
              {r.action?.kind === 'assign_asset' && (
                <SelectInput aria-label="Asset category" value={r.action.assetCategory ?? ''} onChange={(e) => patch(i, { action: { kind: 'assign_asset', assetCategory: (e.target.value || null) as never } })} className="sm:col-span-3">
                  <option value="">Any asset</option>
                  {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>)}
                </SelectInput>
              )}
              {r.action?.kind === 'enrol_course' && (
                <SelectInput aria-label="Course" value={r.action.courseId ?? ''} onChange={(e) => patch(i, { action: { kind: 'enrol_course', courseId: e.target.value || null } })} className="sm:col-span-3">
                  <option value="">Every mandatory course</option>
                  {(opts.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </SelectInput>
              )}
              <label className="flex items-center gap-2 text-xs sm:col-span-3"><Checkbox checked={r.required !== false} onChange={(e) => patch(i, { required: e.target.checked })} />Required</label>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { title: '', ownerRole: 'hr', dueOffsetDays: 0, dueAnchor: 'start', required: true, action: null }])}><Plus />Add item</Button>
      </div>
    </Drawer>
  )
}
