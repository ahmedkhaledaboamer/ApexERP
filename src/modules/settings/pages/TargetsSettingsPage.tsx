import { Info } from 'lucide-react'
import { AgentOverridesCard } from '@/modules/settings/targets/AgentOverridesCard'
import { DefaultTargetsCard } from '@/modules/settings/targets/DefaultTargetsCard'
import { ReadOnlyNote, useSettingsAccess } from '@/modules/settings/lists/shared'
import { EVENTS_ENABLED, EVENTS_NA_NOTE } from '@/shared/lib/features'

/** Settings > Targets: company default monthly targets, plus per-agent targets for a chosen month. */
export default function TargetsSettingsPage() {
  const { canEdit } = useSettingsAccess()
  return (
    <div className="space-y-5">
      {!canEdit && <ReadOnlyNote>You can view targets here. Only a Company Admin can change them.</ReadOnlyNote>}
      {!EVENTS_ENABLED && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2 text-[0.8125rem] text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{EVENTS_NA_NOTE} You can still set an Events attended target here.</span>
        </p>
      )}
      <DefaultTargetsCard canEdit={canEdit} />
      <AgentOverridesCard canEdit={canEdit} />
    </div>
  )
}
