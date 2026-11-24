import type { Role } from '@/shared/types'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton, ErrorState } from '@/shared/components/ui/Feedback'
import { Switch } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { Badge } from '@/shared/components/ui/Badge'
import { AI_TOOLS, type AiToolName } from '../toolSchemas'
import { useAiSettings, useAiUsage, useSaveAiSettings } from '../api'
import type { AiSettingsInput } from '../types'

const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

/** Company Admin: the assistant on / off per role, changes per role, tools; usage counts (never content). */
export function AiSettingsPanel() {
  const settings = useAiSettings(true)
  const usage = useAiUsage(true)
  const save = useSaveAiSettings()
  const toast = useToast()

  function apply(input: AiSettingsInput, what: string) {
    save.mutate(input, {
      onSuccess: () => toast.success('Saved', what),
      onError: (e) => toast.error('Couldn’t save', e instanceof ApiError ? e.message : undefined),
    })
  }

  if (settings.isPending) return <Skeleton className="h-64" />
  if (settings.isError) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />
  const s = settings.data
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Assistant per role"
          description="Turn the assistant on or off for a role, and whether it may prepare changes (every change still needs the user’s confirmation)."
          action={
            <span className="flex items-center gap-2 text-xs text-muted">
              Company-wide
              <Switch checked={s.enabled} label="AI assistant for the company" onChange={(v) => apply({ enabled: v }, v ? 'The assistant is on.' : 'The assistant is off for everyone.')} />
            </span>
          }
        />
        <CardBody className="px-0 pb-2">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y border-line bg-sunken text-xs text-muted">
                <th className="px-5 py-2 text-start font-medium">Role</th>
                <th className="px-3 py-2 text-center font-medium">Assistant</th>
                <th className="px-5 py-2 text-center font-medium">Prepare changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROLES.map((role) => {
                const r = s.roles[role]
                return (
                  <tr key={role}>
                    <td className="px-5 py-2">{role}</td>
                    <td className="px-3 py-2 text-center">
                      <Switch checked={r.enabled} disabled={!s.enabled} label={`${role}: assistant`} onChange={(v) => apply({ roles: { [role]: { enabled: v } } as AiSettingsInput['roles'] }, `${role}: assistant ${v ? 'on' : 'off'}.`)} />
                    </td>
                    <td className="px-5 py-2 text-center">
                      <Switch checked={r.writeTools} disabled={!s.enabled || !r.enabled} label={`${role}: prepare changes`} onChange={(v) => apply({ roles: { [role]: { writeTools: v } } as AiSettingsInput['roles'] }, `${role}: changes ${v ? 'on' : 'off'}.`)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {s.updatedByName && <p className="px-5 pt-3 text-xs text-muted">Last changed by {s.updatedByName}.</p>}
        </CardBody>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Tools" description="A tool that is off is never used. Read tools only look things up; write tools prepare changes for confirmation." />
          <CardBody className="px-0 pb-2">
            <ul className="divide-y divide-line border-y border-line">
              {AI_TOOLS.map((t) => (
                <li key={t.name} className="flex items-center gap-3 px-5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-medium">
                      {t.label} <Badge tone={t.kind === 'write' ? 'amber' : 'neutral'}>{t.kind === 'write' ? 'Change' : 'Read'}</Badge>
                    </p>
                    <p className="truncate text-xs text-muted">{t.description}</p>
                  </div>
                  <Switch checked={s.tools[t.name]} label={t.label} onChange={(v) => apply({ tools: { [t.name]: v } as Record<AiToolName, boolean> }, `${t.label} ${v ? 'on' : 'off'}.`)} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Usage this period" description="Counts only — conversations stay private to each user." />
          <CardBody>
            {usage.isPending ? (
              <Skeleton className="h-24" />
            ) : usage.isError ? (
              <p className="text-xs text-muted">{usage.error.message}</p>
            ) : (
              <>
                <p className="text-[0.8125rem]">
                  <span className="font-semibold tabular-nums">{usage.data.used.toLocaleString()}</span>
                  {usage.data.limit === null ? ' requests (unlimited on your plan)' : ` of ${usage.data.limit.toLocaleString()} requests`}
                </p>
                {usage.data.warning && <p className="mt-1 text-xs text-warning-700 dark:text-warning-500">{usage.data.warning}</p>}
                {usage.data.byUser.length > 0 ? (
                  <table className="mt-3 w-full text-[0.8125rem]">
                    <tbody className="divide-y divide-line">
                      {usage.data.byUser.map((u) => (
                        <tr key={u.userId}>
                          <td className="py-1.5">{u.name}</td>
                          <td className="py-1.5 text-xs text-muted">{u.role}</td>
                          <td className="py-1.5 text-end tabular-nums">{u.requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-2 text-xs text-muted">No requests yet this period.</p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
