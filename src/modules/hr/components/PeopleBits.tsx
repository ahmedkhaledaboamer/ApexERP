import { useState, type ReactNode } from 'react'
import { AlertTriangle, Eye, FileText, Lock } from 'lucide-react'
import type { EmploymentStatus } from '@/modules/hr/types'
import { EMPLOYMENT_STATUS_LABEL } from '@/modules/hr/types'
import type { AssetStatus, ContractStatus, DocumentStatus, HrFile } from '@/modules/hr/peopleTypes'
import { ASSET_STATUS_LABEL, CONTRACT_STATUS_LABEL, DOCUMENT_STATUS_LABEL } from '@/modules/hr/peopleTypes'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'

/** Shared pieces of the Employees / Employee contracts / Company assets screens. */

export const isForbidden = (err: unknown) => (err as { status?: number } | null)?.status === 403

export function HrError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isForbidden(error)) return <EmptyState icon={<Lock />} title="This HR page isn’t available to you" body={error.message} />
  return <ErrorState message={error.message} onRetry={onRetry} />
}

const EMP_TONE: Record<EmploymentStatus, Tone> = { onboarding: 'sky', active: 'green', on_leave: 'amber', notice: 'amber', terminated: 'neutral' }
export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return <Badge tone={EMP_TONE[status]} variant="dot">{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
}

const DOC_TONE: Record<DocumentStatus, Tone> = { valid: 'green', expiring: 'amber', expired: 'red' }
export function DocumentStatusBadge({ status, days }: { status: DocumentStatus; days?: number | null }) {
  const extra = status === 'expiring' && days !== null && days !== undefined ? ` · ${days === 0 ? 'today' : `${days}d`}` : ''
  return <Badge tone={DOC_TONE[status]}>{DOCUMENT_STATUS_LABEL[status]}{extra}</Badge>
}

/** The list badge: an employee with an expired / expiring document. */
export function DocAlertBadge({ alert, count }: { alert: 'expiring' | 'expired' | null; count: number }) {
  if (!alert) return null
  return (
    <Badge tone={alert === 'expired' ? 'red' : 'amber'} icon={<AlertTriangle className="size-3" aria-hidden />}>
      <span aria-label={`${count} document${count === 1 ? '' : 's'} ${alert === 'expired' ? 'expired or expiring' : 'expiring'}`}>{alert === 'expired' ? 'Expired doc' : 'Expiring doc'}</span>
    </Badge>
  )
}

const CONTRACT_TONE: Record<ContractStatus, Tone> = { draft: 'neutral', active: 'green', ended: 'neutral', terminated: 'red', renewed: 'blue' }
export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={CONTRACT_TONE[status]}>{CONTRACT_STATUS_LABEL[status]}</Badge>
}

const ASSET_TONE: Record<AssetStatus, Tone> = { in_stock: 'green', assigned: 'blue', in_repair: 'amber', retired: 'neutral', lost: 'red' }
export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return <Badge tone={ASSET_TONE[status]}>{ASSET_STATUS_LABEL[status]}</Badge>
}

/** Money in a currency, or "•••" when the viewer may not see pay. */
export function Money({ value, currency }: { value: number | null; currency: string }) {
  if (value === null) return <span className="text-muted" aria-label="Hidden">•••</span>
  return <span className="num">{new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)}</span>
}

/** A masked value with an HR-full "Show" button (POST …/reveal, audited); hides again after 30 s. */
export function MaskedValue({ masked, canReveal, reveal, label }: { masked: string; canReveal: boolean; reveal: () => Promise<string>; label: string }) {
  const [shown, setShown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (!masked) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num font-mono text-[0.8125rem]">{shown ?? masked}</span>
      {canReveal && !shown && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Show ${label}`}
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              setShown(await reveal())
              window.setTimeout(() => setShown(null), 30_000)
            } catch (e) {
              toast.error('Not shown', e instanceof Error ? e.message : 'Try again.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Eye />
        </Button>
      )}
    </span>
  )
}

export function FileLink({ file }: { file: HrFile | null }) {
  if (!file) return <span className="text-muted">—</span>
  const size = file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`
  const body = (
    <>
      <FileText className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{file.name}</span>
      <span className="text-muted">({size})</span>
    </>
  )
  return file.url ? (
    <a href={file.url} download={file.name} className="inline-flex max-w-full items-center gap-1 text-[0.8125rem] text-brand-700 hover:underline dark:text-brand-300">{body}</a>
  ) : (
    <span className="inline-flex max-w-full items-center gap-1 text-[0.8125rem] text-ink-2">{body}</span>
  )
}

/** A file picker that turns the chosen file into HrFile metadata (+ a data URL when ≤ 256 KB). */
export function FileInput({ id, value, onChange }: { id: string; value: HrFile | null; onChange: (f: HrFile | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="file"
        className="block w-full text-[0.8125rem] text-ink-2 file:me-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-[0.8125rem] file:text-ink"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const meta = { name: f.name, sizeBytes: f.size, mimeType: f.type || 'application/octet-stream' }
          if (f.size > 256 * 1024) return onChange({ ...meta, url: null })
          const reader = new FileReader()
          reader.onload = () => onChange({ ...meta, url: typeof reader.result === 'string' ? reader.result : null })
          reader.readAsDataURL(f)
        }}
      />
      {value && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Remove
        </Button>
      )}
    </div>
  )
}

export function FormError({ error }: { error: Error | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
      {error.message}
    </p>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Country codes offered in the forms (synthetic short list + free entry). */
export const COUNTRIES: [string, string][] = [
  ['AE', 'United Arab Emirates'],
  ['SA', 'Saudi Arabia'],
  ['EG', 'Egypt'],
  ['IN', 'India'],
  ['PK', 'Pakistan'],
  ['PH', 'Philippines'],
  ['JO', 'Jordan'],
  ['LB', 'Lebanon'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['BD', 'Bangladesh'],
  ['LK', 'Sri Lanka'],
  ['NP', 'Nepal'],
  ['SY', 'Syria'],
  ['SD', 'Sudan'],
]
