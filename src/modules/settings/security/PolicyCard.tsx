import { useEffect, useState } from 'react'
import { Lock, ShieldEllipsis } from 'lucide-react'
import { POLICY_LIMITS, type SecurityPolicy } from '@/modules/settings/security/types'
import { usePolicyQuery, useSavePolicy } from '@/modules/settings/hooks/useSecurity'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, Switch, TextInput } from '@/shared/components/form/Field'

type Draft = { requireTwoFactorForAdmins: boolean; sessionTimeoutMinutes: string; passwordMinLength: string }

function toDraft(p: SecurityPolicy): Draft {
  return {
    requireTwoFactorForAdmins: p.requireTwoFactorForAdmins,
    sessionTimeoutMinutes: String(p.sessionTimeoutMinutes),
    passwordMinLength: String(p.passwordMinLength),
  }
}

function check(value: string, key: keyof typeof POLICY_LIMITS): string | undefined {
  const { min, max } = POLICY_LIMITS[key]
  const n = Number(value)
  if (value.trim() === '' || !Number.isInteger(n)) return 'Enter a whole number.'
  if (n < min || n > max) return `Use ${min} to ${max}.`
  return undefined
}

/** Organisation-wide rules. System Admin edits; Management sees them read-only. */
export function PolicyCard({ canEdit }: { canEdit: boolean }) {
  const query = usePolicyQuery()
  const save = useSavePolicy()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data))
  }, [query.data])

  const errors = draft
    ? {
        sessionTimeoutMinutes: check(draft.sessionTimeoutMinutes, 'sessionTimeoutMinutes'),
        passwordMinLength: check(draft.passwordMinLength, 'passwordMinLength'),
      }
    : {}
  const dirty = !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(toDraft(query.data))
  const valid = !errors.sessionTimeoutMinutes && !errors.passwordMinLength

  function submit() {
    if (!draft || !valid) return
    save.mutate(
      {
        requireTwoFactorForAdmins: draft.requireTwoFactorForAdmins,
        sessionTimeoutMinutes: Number(draft.sessionTimeoutMinutes),
        passwordMinLength: Number(draft.passwordMinLength),
      },
      {
        onSuccess: () => toast.success('Security policy saved', 'Recorded in the audit log.'),
        onError: (e) => toast.error('Couldn’t save the policy', e.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader
        icon={<ShieldEllipsis />}
        title="Security policy"
        description="Rules for every account in the company."
        action={
          !canEdit && (
            <Badge tone="amber" icon={<Lock />}>
              View only
            </Badge>
          )
        }
      />
      <CardBody>
        {query.isPending || (!draft && !query.isError) ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : query.isError || !draft ? (
          <ErrorState message={query.error?.message ?? 'Couldn’t load the policy.'} onRetry={() => query.refetch()} />
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="space-y-4"
          >
            <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-4 py-3">
              <div>
                <p id="pol-2fa-label" className="text-[0.8125rem] font-medium text-ink">
                  Require 2FA for System Admins
                </p>
                <p className="mt-0.5 text-xs text-muted">Admins can’t turn two-factor off while this is on.</p>
              </div>
              <Switch
                id="pol-2fa"
                label="Require 2FA for System Admins"
                checked={draft.requireTwoFactorForAdmins}
                disabled={!canEdit}
                onChange={(v) => setDraft({ ...draft, requireTwoFactorForAdmins: v })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                id="pol-timeout"
                label="Session timeout (minutes)"
                error={errors.sessionTimeoutMinutes}
                hint={`Idle time before sign-out. ${POLICY_LIMITS.sessionTimeoutMinutes.min}–${POLICY_LIMITS.sessionTimeoutMinutes.max}.`}
              >
                <TextInput
                  id="pol-timeout"
                  type="number"
                  inputMode="numeric"
                  min={POLICY_LIMITS.sessionTimeoutMinutes.min}
                  max={POLICY_LIMITS.sessionTimeoutMinutes.max}
                  disabled={!canEdit}
                  invalid={!!errors.sessionTimeoutMinutes}
                  value={draft.sessionTimeoutMinutes}
                  onChange={(e) => setDraft({ ...draft, sessionTimeoutMinutes: e.target.value })}
                />
              </Field>
              <Field
                id="pol-password"
                label="Minimum password length"
                error={errors.passwordMinLength}
                hint={`Characters. ${POLICY_LIMITS.passwordMinLength.min}–${POLICY_LIMITS.passwordMinLength.max}.`}
              >
                <TextInput
                  id="pol-password"
                  type="number"
                  inputMode="numeric"
                  min={POLICY_LIMITS.passwordMinLength.min}
                  max={POLICY_LIMITS.passwordMinLength.max}
                  disabled={!canEdit}
                  invalid={!!errors.passwordMinLength}
                  value={draft.passwordMinLength}
                  onChange={(e) => setDraft({ ...draft, passwordMinLength: e.target.value })}
                />
              </Field>
            </div>
            {canEdit && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => query.data && setDraft(toDraft(query.data))}>
                  Discard
                </Button>
                <Button type="submit" loading={save.isPending} disabled={!dirty || !valid}>
                  Save policy
                </Button>
              </div>
            )}
          </form>
        )}
      </CardBody>
    </Card>
  )
}
