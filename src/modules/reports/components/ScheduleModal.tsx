import { useState, type KeyboardEvent } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarClock, Mail, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Modal } from '@/shared/components/ui/Modal'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { useCreateSchedule, useDeleteSchedule, useSchedules } from '@/modules/reports/hooks/useReports'
import { REPORT_IDS, SCHEDULE_REPORT_TITLES, WEEKDAYS } from '@/modules/reports/lib/reportCatalog'
import type { ReportSchedule, ScheduleFormat, ScheduleFrequency, ScheduleReport } from '@/modules/reports/types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIMES = ['07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '17:00']

function describe(s: Pick<ReportSchedule, 'frequency' | 'day' | 'time'>): string {
  return s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.day - 1]} at ${s.time}` : `Monthly on day ${s.day} at ${s.time}`
}

export function ScheduleModal({ open, onClose, defaultReport, defaultEmail }: { open: boolean; onClose: () => void; defaultReport: ScheduleReport; defaultEmail: string }) {
  const toast = useToast()
  const schedules = useSchedules(open)
  const create = useCreateSchedule()
  const remove = useDeleteSchedule()

  const [report, setReport] = useState<ScheduleReport>(defaultReport)
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly')
  const [weekday, setWeekday] = useState(1)
  const [monthDay, setMonthDay] = useState(1)
  const [time, setTime] = useState('08:00')
  const [fileFormat, setFileFormat] = useState<ScheduleFormat>('excel')
  const [recipients, setRecipients] = useState<string[]>([defaultEmail])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset the report choice to the one on screen whenever the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReport(defaultReport)
      setError(null)
    }
  }

  function addDraft(): boolean {
    const parts = draft.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)
    if (parts.length === 0) return true
    const bad = parts.find((p) => !EMAIL.test(p))
    if (bad) {
      setError(`“${bad}” isn’t a valid e-mail address.`)
      return false
    }
    setRecipients((r) => [...new Set([...r, ...parts])].slice(0, 10))
    setDraft('')
    setError(null)
    return true
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addDraft()
    } else if (e.key === 'Backspace' && !draft && recipients.length) {
      setRecipients((r) => r.slice(0, -1))
    }
  }

  function submit() {
    if (!addDraft()) return
    const list = [...new Set([...recipients, ...draft.split(/[\s,;]+/).filter((p) => EMAIL.test(p))])]
    if (list.length === 0) {
      setError('Add at least one recipient.')
      return
    }
    create.mutate(
      { report, frequency, day: frequency === 'weekly' ? weekday : monthDay, time, recipients: list, format: fileFormat },
      {
        onSuccess: (s) => {
          toast.success('Schedule saved', `${SCHEDULE_REPORT_TITLES[s.report]} · ${describe(s)}`)
          setError(null)
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scheduled e-mail delivery"
      description="Send a report on a schedule. Each recipient gets the figures their sender is allowed to see."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            <CalendarClock />
            Add schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="schedule-report" label="Report">
          <SelectInput id="schedule-report" value={report} onChange={(e) => setReport(e.target.value as ScheduleReport)}>
            {(['all', ...REPORT_IDS] as ScheduleReport[]).map((id) => (
              <option key={id} value={id}>
                {SCHEDULE_REPORT_TITLES[id]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div>
            <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Frequency</p>
            <Tabs<ScheduleFrequency>
              variant="pill"
              label="Frequency"
              value={frequency}
              onChange={setFrequency}
              items={[
                { id: 'weekly', label: 'Weekly' },
                { id: 'monthly', label: 'Monthly' },
              ]}
            />
          </div>
          {frequency === 'weekly' ? (
            <Field id="schedule-day" label="Day">
              <SelectInput id="schedule-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : (
            <Field id="schedule-day" label="Day of month">
              <SelectInput id="schedule-day" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field id="schedule-time" label="Time (GST)">
            <SelectInput id="schedule-time" value={time} onChange={(e) => setTime(e.target.value)}>
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <Field id="schedule-recipients" label="Recipients" hint="Press Enter or comma after each address. Up to 10.">
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5 shadow-xs focus-within:border-brand-500 focus-within:shadow-[var(--shadow-focus)]">
            {recipients.map((r) => (
              <span key={r} className="inline-flex h-6 items-center gap-1 rounded-md bg-sunken ps-2 pe-1 text-xs text-ink-2">
                {r}
                <button type="button" aria-label={`Remove ${r}`} onClick={() => setRecipients((l) => l.filter((x) => x !== r))} className="rounded p-0.5 text-subtle hover:text-ink">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="schedule-recipients"
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => draft && addDraft()}
              placeholder={recipients.length ? '' : 'name@company.ae'}
              className="h-6 min-w-32 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-subtle"
            />
          </div>
        </Field>

        <div>
          <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Attachment</p>
          <Tabs<ScheduleFormat>
            variant="pill"
            label="Attachment format"
            value={fileFormat}
            onChange={setFileFormat}
            items={[
              { id: 'excel', label: 'Excel' },
              { id: 'pdf', label: 'PDF' },
            ]}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
            {error}
          </p>
        )}

        <div className="border-t border-line pt-4">
          <p className="mb-2 text-[0.8125rem] font-semibold">Active schedules</p>
          {schedules.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : schedules.isError ? (
            <p className="text-[0.8125rem] text-danger-600">
              {schedules.error.message}{' '}
              <button type="button" className="underline" onClick={() => schedules.refetch()}>
                Retry
              </button>
            </p>
          ) : schedules.data.length === 0 ? (
            <p className="rounded-lg bg-sunken/70 px-3 py-3 text-[0.8125rem] text-muted">No schedules yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {schedules.data.map((s) => (
                <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-muted">
                    <Mail className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium">
                      {SCHEDULE_REPORT_TITLES[s.report]}
                      <Badge variant="outline">{s.format === 'excel' ? 'Excel' : 'PDF'}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {describe(s)} · next {format(parseISO(s.nextRunAt), 'EEE d MMM, HH:mm')}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted" title={s.recipients.join(', ')}>
                      To {s.recipients.join(', ')} · by {s.createdByName}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={`Delete schedule ${SCHEDULE_REPORT_TITLES[s.report]}`}
                    loading={remove.isPending && remove.variables === s.id}
                    onClick={() =>
                      remove.mutate(s.id, {
                        onSuccess: () => toast.success('Schedule removed'),
                        onError: (e) => toast.error('Couldn’t remove the schedule', e.message),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
