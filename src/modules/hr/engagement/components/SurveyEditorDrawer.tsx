import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { FormError, Section } from '@/modules/hr/components/talentBits'
import { engagementApi, useEngWrite } from '../api'
import {
  DRIVERS,
  DRIVER_LABEL,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  RECURRENCE_LABEL,
  TENURE_BANDS,
  TENURE_LABEL,
  type AudienceType,
  type Driver,
  type EngagementOptions,
  type QuestionType,
  type Recurrence,
  type SurveyQuestionInput,
  type TemplateKey,
  type TenureBand,
} from '../types'

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface Q extends SurveyQuestionInput {
  key: number
  optionsText: string
}

let qseq = 0
const toQ = (q: SurveyQuestionInput): Q => ({ ...q, key: ++qseq, optionsText: (q.options ?? []).map((o) => o.text).join('\n') })

/** HR creates a survey from a template or from scratch, then saves it as a draft or launches it. */
export function SurveyEditorDrawer({ open, onClose, o, onCreated }: { open: boolean; onClose: () => void; o: EngagementOptions; onCreated: (id: string) => void }) {
  return (
    <Drawer open={open} onClose={onClose} width="xl" title="New survey" description="Start from a template or from scratch. Questions can have an Arabic version; people answer in the language they choose.">
      {open && <Editor o={o} onDone={(id) => { onCreated(id); onClose() }} />}
    </Drawer>
  )
}

function Editor({ o, onDone }: { o: EngagementOptions; onDone: (id: string) => void }) {
  const toast = useToast()
  const [templateKey, setTemplateKey] = useState<TemplateKey | ''>('enps_pulse')
  const tpl = o.templates.find((t) => t.key === templateKey)
  const [name, setName] = useState(tpl?.name ?? '')
  const [anonymous, setAnonymous] = useState(tpl?.anonymous ?? true)
  const [recurrence, setRecurrence] = useState<Recurrence>(tpl?.recurrence ?? 'none')
  const [opensOn, setOpensOn] = useState(o.today)
  const [closesOn, setClosesOn] = useState(addDays(o.today, tpl?.durationDays ?? 14))
  const [audienceType, setAudienceType] = useState<AudienceType>('all')
  const [departmentIds, setDepartmentIds] = useState<string[]>([])
  const [bands, setBands] = useState<TenureBand[]>([])
  const [questions, setQuestions] = useState<Q[]>(() => (tpl?.questions ?? []).map(toQ))

  function pickTemplate(key: TemplateKey | '') {
    setTemplateKey(key)
    const t = o.templates.find((x) => x.key === key)
    setName(t?.name ?? '')
    setAnonymous(t?.anonymous ?? true)
    setRecurrence(t?.recurrence ?? 'none')
    setClosesOn(addDays(opensOn, t?.durationDays ?? 14))
    setQuestions((t?.questions ?? [{ type: 'likert' as QuestionType, text: '', textAr: '', driver: null, options: [], required: true }]).map(toQ))
  }
  const patch = (key: number, p: Partial<Q>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...p } : q)))

  const save = useEngWrite(async (launch: boolean) => {
    const s = await engagementApi.saveSurvey({
      name,
      templateKey: templateKey || null,
      kind: tpl?.kind ?? 'custom',
      anonymous,
      recurrence,
      opensOn,
      closesOn,
      audience: { type: audienceType, departmentIds, tenureBands: bands },
      questions: questions.map((q) => ({
        id: q.id,
        type: q.type,
        text: q.text,
        textAr: q.textAr ?? '',
        driver: q.type === 'likert' ? (q.driver ?? null) : null,
        required: q.required ?? true,
        options:
          q.type === 'single' || q.type === 'multi'
            ? q.optionsText
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((text, i) => ({ id: q.options?.[i]?.id, text, textAr: q.options?.[i]?.textAr ?? '' }))
            : [],
      })),
    })
    return launch ? engagementApi.action(s.id, 'launch') : s
  })

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sv-template" label="Template">
          <SelectInput id="sv-template" value={templateKey} onChange={(e) => pickTemplate(e.target.value as TemplateKey | '')}>
            {o.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
            <option value="">From scratch</option>
          </SelectInput>
        </Field>
        <Field id="sv-name" label="Name" required>
          <TextInput id="sv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field id="sv-opens" label="Opens on">
          <TextInput id="sv-opens" type="date" value={opensOn} onChange={(e) => setOpensOn(e.target.value)} />
        </Field>
        <Field id="sv-closes" label="Closes on">
          <TextInput id="sv-closes" type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
        </Field>
        <Field id="sv-recurrence" label="Repeat">
          <SelectInput id="sv-recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABEL[r]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[0.8125rem] text-ink-2">
          <Checkbox checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          Anonymous (no names stored with answers; groups under 5 hidden)
        </label>
      </div>
      {tpl && <p className="text-xs text-muted">{tpl.description}</p>}

      <Section title="Audience">
        <div className="flex flex-wrap gap-4 text-[0.8125rem]">
          {(['all', 'departments', 'tenure'] as AudienceType[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" name="audience" checked={audienceType === t} onChange={() => setAudienceType(t)} className="accent-brand-600" />
              {t === 'all' ? 'Everyone' : t === 'departments' ? 'Departments' : 'Tenure bands'}
            </label>
          ))}
        </div>
        {audienceType === 'departments' && (
          <div className="flex flex-wrap gap-3">
            {o.departments.map((d) => (
              <label key={d.id} className="flex items-center gap-1.5 text-[0.8125rem]">
                <Checkbox checked={departmentIds.includes(d.id)} onChange={(e) => setDepartmentIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)))} />
                {d.name}
              </label>
            ))}
          </div>
        )}
        {audienceType === 'tenure' && (
          <div className="flex flex-wrap gap-3">
            {TENURE_BANDS.map((b) => (
              <label key={b} className="flex items-center gap-1.5 text-[0.8125rem]">
                <Checkbox checked={bands.includes(b)} onChange={(e) => setBands((xs) => (e.target.checked ? [...xs, b] : xs.filter((x) => x !== b)))} />
                {TENURE_LABEL[b]}
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={`Questions · ${questions.length}`}
        action={
          <Button size="xs" variant="secondary" onClick={() => setQuestions((qs) => [...qs, toQ({ type: 'likert', text: '', textAr: '', driver: null, options: [], required: true })])}>
            <Plus />
            Add question
          </Button>
        }
      >
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.key} className="space-y-2 rounded-lg border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">{i + 1}.</span>
                <SelectInput aria-label={`Question ${i + 1} type`} value={q.type} onChange={(e) => patch(q.key, { type: e.target.value as QuestionType })} className="w-52">
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_TYPE_LABEL[t]}
                    </option>
                  ))}
                </SelectInput>
                {q.type === 'likert' && (
                  <SelectInput aria-label={`Question ${i + 1} driver`} value={q.driver ?? ''} onChange={(e) => patch(q.key, { driver: (e.target.value || null) as Driver | null })} className="w-40">
                    <option value="">No driver</option>
                    {DRIVERS.map((d) => (
                      <option key={d} value={d}>
                        {DRIVER_LABEL[d]}
                      </option>
                    ))}
                  </SelectInput>
                )}
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <Checkbox checked={q.required ?? true} onChange={(e) => patch(q.key, { required: e.target.checked })} />
                  Required
                </label>
                <Button size="xs" variant="ghost" iconOnly aria-label={`Remove question ${i + 1}`} className="ms-auto" onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}>
                  <Trash2 />
                </Button>
              </div>
              <TextInput aria-label={`Question ${i + 1} (English)`} placeholder="Question (English)" value={q.text} onChange={(e) => patch(q.key, { text: e.target.value })} maxLength={300} />
              <TextInput aria-label={`Question ${i + 1} (Arabic)`} placeholder="السؤال بالعربية (اختياري)" dir="rtl" value={q.textAr ?? ''} onChange={(e) => patch(q.key, { textAr: e.target.value })} maxLength={300} />
              {(q.type === 'single' || q.type === 'multi') && (
                <textarea
                  aria-label={`Question ${i + 1} choices`}
                  className="w-full rounded-md border border-line bg-surface p-2 text-[0.8125rem]"
                  rows={3}
                  placeholder="One choice per line"
                  value={q.optionsText}
                  onChange={(e) => patch(q.key, { optionsText: e.target.value })}
                />
              )}
            </li>
          ))}
        </ol>
      </Section>
      <FormError error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" write loading={save.isPending && save.variables === false} onClick={() => save.mutate(false, { onSuccess: (s) => { toast.success('Draft saved', s.name); onDone(s.id) } })}>
          Save draft
        </Button>
        <Button write loading={save.isPending && save.variables === true} onClick={() => save.mutate(true, { onSuccess: (s) => { toast.success(s.status === 'open' ? 'Survey launched' : 'Survey scheduled', `${s.name} · ${s.targetCount} people`); onDone(s.id) } })}>
          Launch
        </Button>
      </div>
    </div>
  )
}
