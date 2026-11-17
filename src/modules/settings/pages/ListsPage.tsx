import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Info } from 'lucide-react'
import type { LookupList, Lookups } from '@/modules/settings/types'
import { useLookups, useSaveLookupList } from '@/shared/hooks/useLookups'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { hasErrors, LIST_META, LIST_ORDER, sameList, toDrafts, toPayload, validate, type Drafts } from '@/modules/settings/lists/draft'
import { IndustriesEditor } from '@/modules/settings/lists/IndustriesEditor'
import { ListEditor } from '@/modules/settings/lists/ListEditor'
import { PipelinePreview } from '@/modules/settings/lists/PipelinePreview'
import { InlineError, isValidationError, ReadOnlyNote, SaveBar, useSettingsAccess } from '@/modules/settings/lists/shared'
import { StatusesEditor } from '@/modules/settings/lists/StatusesEditor'

const EMPTY_LOOKUPS: Lookups = { statuses: [], sources: [], industries: [], lossReasons: [], tags: [], serviceCategories: [] }

function isList(v: string | null): v is LookupList {
  return !!v && (LIST_ORDER as string[]).includes(v)
}

/** Settings > Fixed lists: every pick-list in the app. Items are edited, reordered and deactivated, never deleted. */
export default function ListsPage() {
  const lookups = useLookups()
  const { canEdit } = useSettingsAccess()
  const readOnly = !canEdit
  const toast = useToast()
  const save = useSaveLookupList()

  const [params, setParams] = useSearchParams()
  const tab: LookupList = isList(params.get('list')) ? (params.get('list') as LookupList) : 'statuses'

  const base = useMemo(() => toDrafts(lookups.isLoading ? EMPTY_LOOKUPS : lookups.all), [lookups.all, lookups.isLoading])
  const [edits, setEdits] = useState<Partial<Drafts>>({})
  const [serverErrors, setServerErrors] = useState<Partial<Record<LookupList, string>>>({})
  const [showErrors, setShowErrors] = useState<Partial<Record<LookupList, boolean>>>({})

  const drafts: Drafts = { ...base, ...edits }
  const dirty = (list: LookupList) => edits[list] !== undefined && !sameList(list, drafts, base)
  const anyDirty = LIST_ORDER.some(dirty)
  useLeaveGuard(anyDirty && canEdit, 'You have unsaved changes to the fixed lists. Leave anyway?')

  const errors = validate(tab, drafts)

  function setList<K extends LookupList>(list: K, items: Drafts[K]) {
    setEdits((e) => ({ ...e, [list]: items }))
    setServerErrors((s) => ({ ...s, [list]: undefined }))
  }

  function discard(list: LookupList) {
    setEdits((e) => ({ ...e, [list]: undefined }))
    setServerErrors((s) => ({ ...s, [list]: undefined }))
    setShowErrors((s) => ({ ...s, [list]: false }))
  }

  function submit(list: LookupList) {
    if (hasErrors(validate(list, drafts))) {
      setShowErrors((s) => ({ ...s, [list]: true }))
      toast.error('Check the highlighted rows', 'Fix them before saving.')
      return
    }
    save.mutate(
      { list, items: toPayload(list, drafts) },
      {
        onSuccess: () => {
          discard(list)
          toast.success(`${LIST_META[list].label} saved`, 'Pickers across the app use the new list straight away.')
        },
        onError: (err) => {
          if (isValidationError(err)) setServerErrors((s) => ({ ...s, [list]: err.message }))
          else toast.error(`Couldn’t save ${LIST_META[list].label.toLowerCase()}`, err.message)
        },
      },
    )
  }

  function goTo(list: LookupList) {
    const p = new URLSearchParams(params)
    if (list === 'statuses') p.delete('list')
    else p.set('list', list)
    setParams(p, { replace: true })
  }

  if (lookups.isError) {
    return (
      <Card>
        <ErrorState message={lookups.error?.message ?? 'The fixed lists couldn’t be loaded.'} onRetry={() => lookups.refetch()} />
      </Card>
    )
  }

  const meta = LIST_META[tab]
  // Saved lists are valid, so errors only ever come from edits: show them while the list is being edited.
  const showListErrors = dirty(tab) || !!showErrors[tab]
  const itemErrors = showListErrors ? errors.items : {}

  return (
    <div className="space-y-5">
      {readOnly && <ReadOnlyNote>You can view the fixed lists. Only a System Admin can change them.</ReadOnlyNote>}

      <Card>
        <div className="overflow-x-auto px-5">
          <Tabs
            label="Fixed lists"
            value={tab}
            onChange={goTo}
            items={LIST_ORDER.map((list) => ({
              id: list,
              label: LIST_META[list].label,
              count: lookups.isLoading ? undefined : drafts[list].length,
              icon: dirty(list) ? <span aria-label="unsaved" className="size-1.5 rounded-full bg-warning-500" /> : undefined,
            }))}
          />
        </div>

        <div id={`tab-panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          <CardHeader
            title={meta.label}
            description={meta.description}
            action={
              <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
                <Info className="size-3.5" aria-hidden />
                Inactive items stay on old records but can’t be picked.
              </span>
            }
          />
          <p className="-mt-1 px-5 pb-3 text-xs text-muted md:hidden">Inactive items stay on old records but can’t be picked.</p>

          {(serverErrors[tab] || (showListErrors && errors.list.length > 0)) && (
            <div className="space-y-2 px-5 pb-3">
              {serverErrors[tab] && <InlineError>{serverErrors[tab]}</InlineError>}
              {showListErrors &&
                errors.list.map((m) => (
                <InlineError key={m}>{m}</InlineError>
              ))}
            </div>
          )}

          {lookups.isLoading ? (
            <ListSkeleton />
          ) : tab === 'statuses' ? (
            <StatusesEditor items={drafts.statuses} onChange={(v) => setList('statuses', v)} readOnly={readOnly} errors={itemErrors} />
          ) : tab === 'industries' ? (
            <IndustriesEditor items={drafts.industries} onChange={(v) => setList('industries', v)} readOnly={readOnly} errors={itemErrors} />
          ) : (
            <div className="border-t border-line">
              <ListEditor
                items={drafts[tab]}
                onChange={(v) => setList(tab, v)}
                noun={meta.noun}
                label={meta.label}
                readOnly={readOnly}
                errors={itemErrors}
              />
            </div>
          )}

          {!readOnly && !lookups.isLoading && (
            <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
              Drag the grip to reorder, or focus it and press Space, then ↑ ↓. Changes save together with one click.
            </p>
          )}
        </div>
      </Card>

      {tab === 'statuses' && !lookups.isLoading && <PipelinePreview statuses={drafts.statuses} />}

      <SaveBar
        visible={canEdit && dirty(tab)}
        saving={save.isPending}
        onSave={() => submit(tab)}
        onDiscard={() => discard(tab)}
        message={
          <>
            You have unsaved changes <span className="font-normal text-muted">· {meta.label}</span>
          </>
        }
      />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading list" className="space-y-3 border-t border-line px-5 py-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  )
}
