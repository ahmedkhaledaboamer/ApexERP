import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Image as ImageIcon, Lock, Palette, RotateCcw, Type } from 'lucide-react'
import type { Branding } from '@/modules/tenancy/types'
import {
  DISPLAY_NAME_MAX,
  FAVICON_MAX_BYTES,
  LOGO_MAX_BYTES,
  displayNameProblem,
  formatBytes,
  type BrandingPatch,
} from '@/modules/settings/branding'
import { useBrandingSettingsQuery, useResetBranding, useSaveBranding } from '@/modules/settings/hooks/useBrandingSettings'
import { ImageField } from '@/modules/settings/branding/ImageField'
import { ColorField } from '@/modules/settings/branding/ColorField'
import { BrandPreviews } from '@/modules/settings/branding/BrandPreviews'
import { deriveBrandScale, normalizeHex } from '@/modules/tenancy/palette'
import { monogramFor } from '@/modules/tenancy/subdomain'
import { canEditCompanyProfile } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextInput } from '@/shared/components/form/Field'

interface Draft {
  displayName: string
  primaryColor: string
  logoLight: string | null
  logoDark: string | null
  favicon: string | null
}

function toDraft(b: Branding, primary: string): Draft {
  return { displayName: b.displayName, primaryColor: primary, logoLight: b.logoUrl ?? null, logoDark: b.logoDarkUrl ?? null, favicon: b.faviconUrl ?? null }
}

/** Only what changed (images: data URL to set, null to remove). */
function toPatch(d: Draft, saved: Draft): BrandingPatch {
  const p: BrandingPatch = {}
  if (d.displayName.trim() !== saved.displayName) p.displayName = d.displayName.trim()
  if (d.primaryColor !== saved.primaryColor) p.primaryColor = d.primaryColor
  if (d.logoLight !== saved.logoLight) p.logoLight = d.logoLight
  if (d.logoDark !== saved.logoDark) p.logoDark = d.logoDark
  if (d.favicon !== saved.favicon) p.favicon = d.favicon
  return p
}

/**
 * Settings › Branding: workspace name, light and dark logos, favicon and primary colour, with live
 * previews (header, sign-in card, browser tab; light and dark). Company Admin edits; Management sees
 * it read-only. Saving replaces the session tenant, so the whole app re-brands without a reload.
 */
export default function BrandingPage() {
  const user = useCurrentUser()
  const canEdit = !!user && canEditCompanyProfile(user.role)
  const query = useBrandingSettingsQuery()
  const save = useSaveBranding()
  const reset = useResetBranding()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const saved = useMemo(() => (query.data ? toDraft(query.data.branding, query.data.primaryColor) : null), [query.data])
  useEffect(() => {
    if (saved) setDraft(saved)
  }, [saved])

  const nameError = draft ? displayNameProblem(draft.displayName) : null
  const hex = draft ? normalizeHex(draft.primaryColor) : null
  const patch = draft && saved ? toPatch(draft, saved) : {}
  const dirty = Object.keys(patch).length > 0
  const valid = !nameError && !!hex

  const previewBranding: Branding | null = useMemo(() => {
    if (!draft || !query.data) return null
    const b = query.data.branding
    const name = draft.displayName.trim() || b.displayName
    return {
      ...b,
      displayName: name,
      monogram: name === b.displayName ? b.monogram : monogramFor(name),
      logoUrl: draft.logoLight,
      logoDarkUrl: draft.logoDark,
      faviconUrl: draft.favicon,
      palette: hex ? deriveBrandScale(hex) : b.palette,
    }
  }, [draft, query.data, hex])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setSaveError(null)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canEdit || !dirty || !valid) return
    save.mutate(patch, {
      onSuccess: () => toast.success('Branding saved', 'The new look applies everywhere now. Recorded in the audit log.'),
      onError: (err) => {
        setSaveError(err.message)
        toast.error('Couldn’t save the branding', err.message)
      },
    })
  }

  return (
    <div className="space-y-5" id="branding-page" data-can-edit={canEdit ? 'true' : 'false'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Branding</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            Your logo, favicon and colour across the app, the sign-in page, quotations and emails. Every change is recorded in the audit log.
          </p>
        </div>
        {canEdit ? (
          <Button id="branding-reset" variant="secondary" size="sm" write onClick={() => setConfirmReset(true)}>
            <RotateCcw />
            Reset to default
          </Button>
        ) : (
          <Badge tone="amber" icon={<Lock />}>
            View only
          </Badge>
        )}
      </div>

      {query.isPending || (!draft && !query.isError) ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      ) : query.isError || !draft || !previewBranding ? (
        <Card>
          <ErrorState message={query.error?.message ?? 'Couldn’t load the branding.'} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          <form noValidate onSubmit={onSubmit} className="min-w-0 space-y-5">
            {!canEdit && (
              <p role="note" id="branding-readonly-note" className="rounded-lg border border-line bg-sunken px-4 py-3 text-[0.8125rem] text-muted">
                Only a Company Admin can change the branding. You can see what the workspace looks like.
              </p>
            )}
            <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
              <Section icon={<Type />} title="Workspace name" description="Shown next to the logo in the header, the workspace switcher and the sign-in page.">
                <Field id="branding-name" label="Workspace name" required error={nameError ?? undefined} hint={`Up to ${DISPLAY_NAME_MAX} characters. The monogram uses its initials.`}>
                  <TextInput
                    id="branding-name"
                    value={draft.displayName}
                    maxLength={DISPLAY_NAME_MAX + 10}
                    invalid={!!nameError}
                    onChange={(e) => set('displayName', e.target.value)}
                  />
                </Field>
              </Section>

              <Section
                icon={<ImageIcon />}
                title="Logo"
                description={`PNG, JPG, SVG or WebP up to ${formatBytes(LOGO_MAX_BYTES)}. Upload a version for dark mode too if your logo is dark.`}
              >
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <ImageField
                    kind="logoLight"
                    title="Light mode logo"
                    hint="On white: header, sign-in page, quotations, emails."
                    value={draft.logoLight}
                    surface="light"
                    disabled={!canEdit}
                    onChange={(url) => set('logoLight', url)}
                  />
                  <ImageField
                    kind="logoDark"
                    title="Dark mode logo"
                    hint="On dark backgrounds. Optional: the light logo is used otherwise."
                    value={draft.logoDark}
                    surface="dark"
                    disabled={!canEdit}
                    onChange={(url) => set('logoDark', url)}
                  />
                </div>
              </Section>

              <Section icon={<ImageIcon />} title="Favicon" description={`The browser tab icon. Square PNG, JPG, SVG or WebP up to ${formatBytes(FAVICON_MAX_BYTES)}.`}>
                <div className="max-w-xs">
                  <ImageField
                    kind="favicon"
                    title="Favicon"
                    hint="Shown while signed in and on your sign-in page."
                    value={draft.favicon}
                    surface="light"
                    disabled={!canEdit}
                    onChange={(url) => set('favicon', url)}
                  />
                </div>
              </Section>

              <Section icon={<Palette />} title="Primary colour" description="Buttons, links, the active menu item, focus rings and charts. The full scale is generated from it.">
                <ColorField value={hex ?? draft.primaryColor} scale={previewBranding.palette} disabled={!canEdit} onChange={(v) => set('primaryColor', v)} />
              </Section>
            </fieldset>

            {canEdit && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {saveError && (
                  <p role="alert" id="branding-save-error" className="me-auto text-[0.8125rem] text-danger-600 dark:text-danger-500">
                    {saveError}
                  </p>
                )}
                <Button
                  id="branding-discard"
                  variant="secondary"
                  disabled={!dirty || save.isPending}
                  onClick={() => {
                    if (saved) setDraft(saved)
                    setSaveError(null)
                  }}
                >
                  Discard changes
                </Button>
                <Button id="branding-save" write type="submit" loading={save.isPending} disabled={!dirty || !valid}>
                  Save branding
                </Button>
              </div>
            )}
          </form>

          <aside aria-label="Branding preview" className="min-w-0 2xl:sticky 2xl:top-4">
            <Card>
              <CardHeader title="Preview" description={dirty ? 'Showing your unsaved changes.' : 'How the workspace looks today.'} />
              <CardBody>
                <BrandPreviews branding={previewBranding} />
              </CardBody>
            </Card>
          </aside>
        </div>
      )}

      <Modal
        open={confirmReset}
        onClose={() => !reset.isPending && setConfirmReset(false)}
        size="sm"
        title="Reset the branding?"
        description="Removes both logos and the favicon and goes back to the monogram and the default violet palette. The workspace name stays."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)} disabled={reset.isPending}>
              Cancel
            </Button>
            <Button
              id="branding-reset-confirm"
              variant="danger"
              loading={reset.isPending}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmReset(false)
                    toast.success('Branding reset', 'The monogram and default colours are back. Recorded in the audit log.')
                  },
                  onError: (err) => toast.error('Couldn’t reset the branding', err.message),
                })
              }
            >
              Reset to default
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">Applies right away for everyone in the workspace.</p>
      </Modal>
    </div>
  )
}

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}
