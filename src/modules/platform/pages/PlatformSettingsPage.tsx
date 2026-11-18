import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PlatformSettings } from '@/modules/platform/types'
import { updatePlatformSettings } from '@/modules/platform/api'
import { platformKeys, usePlatform, usePlatformSettings } from '@/modules/platform/hooks'
import { SETTING_SPECS, changedSettings, parseSettings, settingsDraft, type SettingsDraft } from '@/modules/platform/settingsForm'
import { MIN_REASON } from '@/modules/platform/format'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Card, CardBody } from '@/shared/components/ui/Card'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/** Platform settings (trial, dunning, retention, usage warnings, subdomain redirects, support sessions). */
export default function PlatformSettingsPage() {
  const query = usePlatformSettings()
  return (
    <>
      <PageHeader title="Settings" description="Platform-wide billing and support rules. Changes apply to every company from now on." />
      <PageBody className="max-w-3xl">
        {query.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <SettingsForm settings={query.data} />
        )}
      </PageBody>
    </>
  )
}

function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(settings))
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => setDraft(settingsDraft(settings)), [settings])

  const { errors, value } = parseSettings(draft)
  const diff = value ? changedSettings(settings, value) : {}
  const dirty = Object.keys(diff).length > 0
  const reasonOk = reason.trim().length >= MIN_REASON

  const save = useMutation({
    mutationFn: () => updatePlatformSettings(token, { ...diff, reason: reason.trim() }),
    onSuccess: (next) => {
      qc.setQueryData(platformKeys.settings, next)
      void qc.invalidateQueries({ queryKey: platformKeys.settings })
      setReason('')
      setSubmitted(false)
      toast.success('Settings saved')
    },
  })

  return (
    <form
      id="platform-settings-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
        if (!value || !dirty || !reasonOk) return
        save.mutate()
      }}
    >
      <Card>
        <CardBody className="grid grid-cols-1 gap-5 pt-5 sm:grid-cols-2">
          {SETTING_SPECS.map((spec) => (
            <Field key={spec.key} id={`setting-${spec.key}`} label={`${spec.label} (${spec.unit})`} hint={spec.hint} error={errors[spec.key]}>
              <TextInput
                id={`setting-${spec.key}`}
                data-setting={spec.key}
                inputMode={spec.kind === 'number' ? 'numeric' : 'text'}
                value={draft[spec.key]}
                invalid={!!errors[spec.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [spec.key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field
            id="settings-reason"
            label="Reason"
            required
            className="sm:col-span-2"
            hint="Required. Saved in the platform audit log."
            error={submitted && !reasonOk ? `Enter a reason (at least ${MIN_REASON} characters).` : undefined}
          >
            <TextArea id="settings-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />
          </Field>
          {save.isError && (
            <p role="alert" id="settings-error" className="text-[0.8125rem] text-danger-600 sm:col-span-2">
              {save.error.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3 sm:col-span-2">
            <span className="text-xs text-muted" id="settings-dirty" data-dirty={String(dirty)}>
              {dirty ? `${Object.keys(diff).length} unsaved ${Object.keys(diff).length === 1 ? 'change' : 'changes'}` : 'No changes'}
            </span>
            <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setDraft(settingsDraft(settings))}>
              Reset
            </Button>
            <Button id="settings-save" type="submit" loading={save.isPending} disabled={!value || !dirty}>
              Save settings
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  )
}
