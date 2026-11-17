import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { SheetFile } from './importModel'

export const STEPS = ['Upload', 'Map columns', 'Clean values', 'Duplicates', 'Import'] as const

/** Horizontal stepper; collapses to "Step n of 5 · Label" on phones. */
export function ImportStepper({ step, maxReached, onJump }: { step: number; maxReached: number; onJump: (i: number) => void }) {
  return (
    <>
      <p className="text-[0.8125rem] text-muted sm:hidden">
        Step {step + 1} of {STEPS.length} · <span className="font-medium text-ink">{STEPS[step]}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex" aria-label="Import steps">
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          const reachable = i <= maxReached && i !== step
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onJump(i)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md py-1 pe-1.5 text-[0.8125rem] transition-colors',
                  reachable ? 'hover:text-ink' : 'cursor-default',
                  current ? 'font-medium text-ink' : done ? 'text-ink-2' : 'text-muted',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset',
                    current && 'bg-brand-600 text-white ring-brand-600 dark:bg-brand-500',
                    done && 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
                    !current && !done && 'bg-surface text-muted ring-line-strong',
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className={cn('h-px min-w-4 flex-1', done ? 'bg-brand-300 dark:bg-brand-500/40' : 'bg-line-strong')} />}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** Two- or three-way toggle (Skip / Import, etc.). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'xs' | 'sm'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            size === 'xs' ? 'h-6 text-xs' : 'h-7 text-[0.8125rem]',
            value === o.value ? 'bg-surface text-ink shadow-xs ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tile({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'brand'; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          'num mt-1 text-2xl font-semibold tracking-tight',
          tone === 'green' && 'text-success-700 dark:text-success-500',
          tone === 'amber' && 'text-warning-700 dark:text-warning-500',
          tone === 'red' && 'text-danger-700 dark:text-danger-500',
          tone === 'brand' && 'text-brand-700 dark:text-brand-300',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/**
 * A small messy "Lead Tracker" export, for trying the wizard without a file: free-typed
 * sources/statuses/owners, local mobile formats, a bad email, and duplicates (in the file and
 * against seeded leads).
 */
export function sampleSheet(): SheetFile {
  const headers = ['Company', 'Contact', 'Mobile', 'Email', 'Source', 'Industry', 'Status', 'Owner', 'Next follow-up', 'Notes']
  const rows = [
    ['Bayview Dental Clinic', 'Dr. Sana Iqbal', '050 123 4567', 'Sana@BayviewDental.ae ', 'web', 'Clinic', 'hot', 'Bincy', '20/11/2026', 'Asked for chatbot pricing'],
    ['Emirates Smile Dental', 'Rami Haddad', '0551234567', 'rami@emiratessmile.ae', 'Linkedin', 'Healthcare', 'follow up', 'Bincy', '2026-11-25', 'Already in CRM?'],
    ['Skyline Realty LLC', 'Omar Farouk', '971 52 555 1212', 'omar@skylinerealty.ae', 'GITEX 2025', 'real estate', 'meeting done', 'Ahmed', '28-11-2026', ''],
    ['Golden Sands Hotel', 'Maria Lopez', '+971-56-777-8899', 'maria.lopez@gmail.com', 'cold call', 'Hotels', 'no answer', 'priya r', '', 'Try again Sunday'],
    ['Al Noor Medical Group', 'Reception', '04 321 0000', 'info@alnoormedical.ae', 'google', 'Healthcare', 'new', '', '2026-11-30', 'Same group as Al Noor Medical Centre?'],
    ['Desert Falcon Logistics', 'Kiran Rao', '0509876543', 'kiran@desertfalcon', 'referral - Khalid', 'freight', 'quote sent', 'Ahmed', '02/12/2026', ''],
    ['Bayview Dental Clinic', 'Front desk', '050 123 4567', 'hello@bayviewdental.ae', 'Website', 'Healthcare', 'contacted', 'Bincy', '21/11/2026', 'Duplicate row from 2nd sheet'],
    ['Pearl Academy Dubai', 'Ms. Anita Shah', '0561112233', 'anita@pearlacademy.ae', 'Directory', 'school', 'interested', 'Priya', '2026-11-22', 'Wants WhatsApp bot for admissions'],
    ['Metro Motors', 'Faisal', '12345', 'faisal@metromotors.ae', 'event', 'Auto dealer', 'lost', 'Hassan', '', 'Went with competitor'],
    ['', 'Unknown', '0501112222', 'someone@nowhere.ae', 'web', 'Retail', 'new', '', '', 'Company missing'],
    ['Oasis Fit-out Co', 'Jamal Nasser', '0527654321', 'jamal@oasisfitout.ae', 'cold email', 'Interior fit out', 'call later', 'Ahmed A', '05 Dec 2026', ''],
    ['Bright Minds Training', 'Leena', '0543216789', 'leena@brightminds.ae', 'Instagram', 'Training', 'new', 'Priya', '2026-11-19', ''],
  ]
  return { fileName: 'Lead Tracker (sample).xlsx', headers, rows, rowNumbers: rows.map((_, i) => i + 2) }
}
