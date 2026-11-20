import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, UploadCloud } from 'lucide-react'
import { ASSET_KINDS, ASSET_KIND_LABEL, type AssetKind, type BrandAsset } from '@/modules/marketing/creative/types'
import { acceptFor, allowedText, assetFileProblem, ASSET_MAX_BYTES, checkPreview, kindForMime } from '@/modules/marketing/creative/assetRules'
import { readPickedFile, type PickedFile } from '@/modules/marketing/creative/upload'
import { useCreateAsset } from '@/modules/marketing/creative/hooks'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { formatBytes } from '@/modules/settings/branding'
import { Modal } from '@/shared/components/ui/Modal'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'

/**
 * Upload a brand asset: the file is checked in the browser with the same rules the API applies
 * (assetRules.ts: type per kind, size limit, real image content); the plan's storage limit is
 * checked by the API (402 shows the upgrade prompt).
 */
export function UploadAssetModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (a: BrandAsset) => void }) {
  const create = useCreateAsset()
  const options = useMarketingOptions()
  const toast = useToast()
  const [file, setFile] = useState<PickedFile | null>(null)
  const [kind, setKind] = useState<AssetKind>('image')
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [expires, setExpires] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setFile(null)
    setKind('image')
    setName('')
    setTags('')
    setCampaignId('')
    setExpires('')
    setError('')
  }, [open])

  async function pick(f: File | undefined) {
    setError('')
    if (!f) return
    const picked = await readPickedFile(f)
    const k = kindForMime(picked.mimeType)
    setFile(picked)
    setKind(k)
    if (!name) setName(picked.name.replace(/\.[^.]+$/, ''))
    const preview = picked.dataUrl ? checkPreview(picked.dataUrl, picked.mimeType, picked.sizeBytes) : null
    const problem = assetFileProblem(k, picked) ?? (preview && !preview.ok ? preview.message : null)
    if (problem) setError(problem)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Pick a file to upload.')
    const preview = file.dataUrl ? checkPreview(file.dataUrl, file.mimeType, file.sizeBytes) : null
    const problem = assetFileProblem(kind, { ...file, name: name || file.name }) ?? (preview && !preview.ok ? preview.message : null)
    if (problem) return setError(problem)
    create.mutate(
      {
        name: name.trim() || file.name,
        kind,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        dataUrl: file.dataUrl,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        campaignId: campaignId || null,
        usageRightsExpiresAt: expires || null,
      },
      {
        onSuccess: (a) => {
          toast.success('Asset uploaded', a.name)
          onSaved?.(a)
          onClose()
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload asset"
      description={`${ASSET_KIND_LABEL[kind]}: ${allowedText(kind)}, up to ${formatBytes(ASSET_MAX_BYTES[kind])}.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="asset-upload" loading={create.isPending} disabled={!file}>
            Upload
          </Button>
        </div>
      }
    >
      <form id="asset-upload" onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-[0.8125rem] text-muted hover:bg-hover">
          <UploadCloud className="size-6" aria-hidden />
          {file ? (
            <span className="text-ink">
              {file.name} · {formatBytes(file.sizeBytes)}
            </span>
          ) : (
            'Choose a file'
          )}
          <input type="file" className="sr-only" aria-label="Asset file" accept={acceptFor('any')} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="up-name" label="Name">
            <TextInput id="up-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="up-kind" label="Kind">
            <SelectInput
              id="up-kind"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as AssetKind
                setKind(k)
                setError(file ? (assetFileProblem(k, file) ?? '') : '')
              }}
            >
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABEL[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="up-tags" label="Tags" hint="Comma separated">
            <TextInput id="up-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field id="up-expires" label="Usage rights expire">
            <TextInput id="up-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <Field id="up-campaign" label="Campaign">
          <SelectInput id="up-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">No campaign</option>
            {(options.data?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </Modal>
  )
}
