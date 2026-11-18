import { useEffect, useState } from 'react'
import { SUBDOMAIN_PATTERN, subdomainProblem } from '@/modules/tenancy/subdomain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Globe, X } from 'lucide-react'
import type { PlatformCompanyDetail } from '@/modules/platform/types'
import { changeSubdomain, checkPlatformSubdomain } from '@/modules/platform/api'
import { platformKeys, usePlatform, usePlatformSettings } from '@/modules/platform/hooks'
import { fmtDate, fmtDateTime } from '@/modules/platform/format'
import { ConfirmReasonDialog } from '@/modules/platform/components/ConfirmReasonDialog'
import { ROOT_DOMAIN } from '@/shared/lib/tenantContext'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Button } from '@/shared/components/ui/Button'
import { Field, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'


function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Current address, old addresses that still redirect, and (tenants:subdomain) "Change subdomain". */
export function SubdomainCard({ detail, canChange }: { detail: PlatformCompanyDetail; canChange: boolean }) {
  const [open, setOpen] = useState(false)
  const { company, subdomainAliases } = detail
  const now = Date.now()
  return (
    <Card id="pc-subdomain" data-subdomain={company.subdomain}>
      <CardHeader
        icon={<Globe />}
        title="Workspace address"
        action={
          canChange && (
            <Button id="action-change-subdomain" size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Change subdomain
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        <p className="font-mono text-[0.8125rem] text-ink" id="pc-subdomain-current">
          {company.subdomain}.{ROOT_DOMAIN}
        </p>
        {subdomainAliases.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Previous addresses</p>
            <ul className="divide-y divide-line rounded-lg border border-line" id="pc-subdomain-aliases">
              {subdomainAliases.map((a) => {
                const active = Date.parse(a.redirectUntil) > now
                return (
                  <li key={a.subdomain + a.changedAt} data-alias={a.subdomain} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[0.8125rem]">
                    <span className="font-mono text-ink-2">
                      {a.subdomain}.{ROOT_DOMAIN}
                    </span>
                    <span className={active ? 'text-xs text-muted' : 'text-xs text-subtle line-through'}>
                      {active ? 'Redirects until' : 'Redirected until'} {fmtDate(a.redirectUntil)}
                    </span>
                    <span className="ms-auto text-xs text-subtle">
                      Changed {fmtDateTime(a.changedAt)} by {a.changedBy}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted">No previous addresses.</p>
        )}
      </CardBody>
      {canChange && <ChangeSubdomainDialog open={open} onClose={() => setOpen(false)} detail={detail} />}
    </Card>
  )
}

function ChangeSubdomainDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: PlatformCompanyDetail }) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  const settings = usePlatformSettings(open)
  const days = settings.data?.subdomainRedirectDays ?? null
  const [value, setValue] = useState('')
  useEffect(() => {
    if (open) setValue('')
  }, [open])

  const candidate = value.trim().toLowerCase()
  const debounced = useDebounced(candidate, 350)
  const formatOk = SUBDOMAIN_PATTERN.test(candidate)
  const same = candidate === detail.company.subdomain
  const check = useQuery({
    queryKey: ['platform', 'subdomain-check', detail.company.id, debounced],
    queryFn: ({ signal }) => checkPlatformSubdomain(token, debounced, detail.company.id, signal),
    enabled: open && SUBDOMAIN_PATTERN.test(debounced) && debounced !== detail.company.subdomain,
    staleTime: 10_000,
  })
  const settled = debounced === candidate && !check.isFetching
  const available = settled && check.data?.subdomain === candidate && check.data.available

  const save = useMutation({
    mutationFn: (reason: string) => changeSubdomain(token, detail.company.id, { subdomain: candidate, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: platformKeys.all })
      toast.success('Subdomain changed', `${detail.company.subdomain} now redirects to ${candidate}.`)
      onClose()
    },
  })

  let status: { ok: boolean; text: string } | null = null
  if (candidate && !formatOk) status = { ok: false, text: subdomainProblem(candidate) ?? 'Not a valid subdomain.' }
  else if (same) status = { ok: false, text: 'That’s the current subdomain.' }
  else if (candidate && formatOk && settled && check.data?.subdomain === candidate)
    status = check.data.available ? { ok: true, text: 'Available' } : { ok: false, text: check.data.reason ?? 'Not available' }
  else if (check.isError && settled) status = { ok: false, text: check.error.message }

  return (
    <ConfirmReasonDialog
      id="subdomain-dialog"
      open={open}
      onClose={() => {
        save.reset()
        onClose()
      }}
      title="Change subdomain"
      description={`${detail.company.name} is at ${detail.company.subdomain}.${ROOT_DOMAIN}.`}
      confirmLabel="Change subdomain"
      canConfirm={!!available}
      pending={save.isPending}
      error={save.isError ? save.error.message : null}
      onConfirm={(reason) => save.mutate(reason)}
    >
      <Field id="subdomain-input" label="New subdomain" required>
        <div className="flex items-center gap-2">
          <TextInput
            id="subdomain-input"
            value={value}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            placeholder="new-name"
            className="font-mono"
          />
          <span className="shrink-0 font-mono text-[0.8125rem] text-muted">.{ROOT_DOMAIN}</span>
        </div>
      </Field>
      <p
        id="subdomain-check"
        aria-live="polite"
        data-available={status ? String(status.ok) : undefined}
        className={status ? (status.ok ? 'flex items-center gap-1.5 text-xs text-success-700 dark:text-success-500' : 'flex items-center gap-1.5 text-xs text-danger-600 dark:text-danger-500') : 'text-xs text-muted'}
      >
        {candidate && formatOk && !same && !settled ? (
          'Checking…'
        ) : status ? (
          <>
            {status.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
            {status.text}
          </>
        ) : (
          'Type a subdomain to check it.'
        )}
      </p>
      <div
        id="subdomain-warning"
        className="flex gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Users sign in at the new address from now on. The old address <span className="font-mono">{detail.company.subdomain}.{ROOT_DOMAIN}</span>{' '}
          redirects to it for {days ? <span className="font-semibold" data-days={days}>{days} days</span> : 'a limited time'}, then stops working.
          Bookmarks and email links using it will break after that.
        </p>
      </div>
    </ConfirmReasonDialog>
  )
}
