import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ArchiveRestore, Download, Lock, Trash2 } from 'lucide-react'
import { ASSET_KINDS, ASSET_KIND_LABEL, type AssetKind, type BrandAsset } from '@/modules/marketing/creative/types'
import { useCreativeAccess, useDeleteAsset, useUpdateAsset } from '@/modules/marketing/creative/hooks'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { designRequestPath } from '@/modules/marketing/paths'
import { formatBytes } from '@/modules/settings/branding'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { Property, PropertyList } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { AssetKindBadge } from './badges'
import { AssetThumb } from './AssetPicker'

/** Preview and details of a brand asset; marketing `full` roles edit, archive or delete it (not system assets). */
export function AssetDrawer({ asset, onClose }: { asset: BrandAsset | null; onClose: () => void }) {
  return (
    <Drawer open={!!asset} onClose={onClose} title={asset?.name ?? 'Asset'} description={asset ? <AssetKindBadge kind={asset.kind} /> : undefined}>
      {asset && <AssetDetail asset={asset} onClose={onClose} />}
    </Drawer>
  )
}

function AssetDetail({ asset, onClose }: { asset: BrandAsset; onClose: () => void }) {
  const { canEdit } = useCreativeAccess()
  const options = useMarketingOptions()
  const update = useUpdateAsset()
  const remove = useDeleteAsset()
  const toast = useToast()
  const editable = canEdit && !asset.system
  const [name, setName] = useState(asset.name)
  const [kind, setKind] = useState<AssetKind>(asset.kind)
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [campaignId, setCampaignId] = useState(asset.campaignId ?? '')
  const [expires, setExpires] = useState(asset.usageRightsExpiresAt ?? '')
  const [description, setDescription] = useState(asset.description)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(asset.name)
    setKind(asset.kind)
    setTags(asset.tags.join(', '))
    setCampaignId(asset.campaignId ?? '')
    setExpires(asset.usageRightsExpiresAt ?? '')
    setDescription(asset.description)
    setError('')
  }, [asset])

  function save(e: FormEvent) {
    e.preventDefault()
    update.mutate(
      {
        id: asset.id,
        input: { name, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), campaignId: campaignId || null, usageRightsExpiresAt: expires || null, description },
      },
      { onSuccess: () => toast.success('Asset saved', name), onError: (err) => setError(err.message) },
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid place-items-center rounded-card border border-line bg-sunken/60 p-4">
        <AssetThumb asset={asset} className="max-h-64 min-h-32 w-full max-w-full border-0 bg-transparent" />
      </div>
      {asset.system && (
        <p className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-[0.8125rem] text-muted">
          <Lock className="size-4" aria-hidden />
          System asset from Settings › Branding. Change it there.
        </p>
      )}
      {(asset.expiringSoon || asset.expired) && (
        <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
          {asset.expired ? 'Usage rights have expired. Stop using it or renew the licence.' : `Usage rights end on ${fmtDate(asset.usageRightsExpiresAt)}.`}
        </p>
      )}
      <PropertyList>
        <Property label="File">{`${asset.mimeType}${asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ''}`}</Property>
        <Property label="Source">
          {asset.source === 'design_request' && asset.designRequestId ? (
            <Link to={designRequestPath(asset.designRequestId)} className="text-brand-700 hover:underline dark:text-brand-300">
              Design request
            </Link>
          ) : asset.source === 'system' ? (
            'Branding'
          ) : (
            'Upload'
          )}
        </Property>
        <Property label="Added">{`${asset.createdByName} · ${fmtDate(asset.createdAt)}`}</Property>
        <Property label="Status">{asset.status === 'archived' ? <Badge>Archived</Badge> : <Badge tone="green">Active</Badge>}</Property>
      </PropertyList>
      {asset.url && (
        <a href={asset.url} download={asset.name} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-700 hover:underline dark:text-brand-300">
          <Download className="size-4" aria-hidden />
          Download
        </a>
      )}

      {editable ? (
        <form onSubmit={save} className="space-y-4 border-t border-line pt-4" noValidate>
          {error && (
            <p role="alert" className="text-[0.8125rem] text-danger-600">
              {error}
            </p>
          )}
          <Field id="as-name" label="Name">
            <TextInput id="as-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="as-kind" label="Kind">
              <SelectInput id="as-kind" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
                {ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ASSET_KIND_LABEL[k]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field id="as-expires" label="Usage rights expire">
              <TextInput id="as-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
          </div>
          <Field id="as-tags" label="Tags" hint="Comma separated">
            <TextInput id="as-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field id="as-campaign" label="Campaign">
            <SelectInput id="as-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">No campaign</option>
              {(options.data?.campaigns ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="as-desc" label="Description">
            <TextArea id="as-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button
                write
                size="sm"
                variant="secondary"
                onClick={() => update.mutate({ id: asset.id, input: { status: asset.status === 'archived' ? 'active' : 'archived' } }, { onError: (err) => setError(err.message) })}
              >
                {asset.status === 'archived' ? <ArchiveRestore /> : <Archive />}
                {asset.status === 'archived' ? 'Restore' : 'Archive'}
              </Button>
              <Button
                write
                size="sm"
                variant="ghost"
                onClick={() =>
                  remove.mutate(asset.id, {
                    onSuccess: () => {
                      toast.success('Asset deleted', asset.name)
                      onClose()
                    },
                    onError: (err) => setError(err.message),
                  })
                }
              >
                <Trash2 />
                Delete
              </Button>
            </div>
            <Button write type="submit" size="sm" loading={update.isPending}>
              Save asset
            </Button>
          </div>
        </form>
      ) : (
        <PropertyList>
          <Property label="Tags">{asset.tags.length ? asset.tags.join(', ') : '—'}</Property>
          <Property label="Campaign">{asset.campaignName || '—'}</Property>
          <Property label="Usage rights">{asset.usageRightsExpiresAt ? fmtDate(asset.usageRightsExpiresAt) : 'No end date'}</Property>
          <Property label="Description">{asset.description || '—'}</Property>
        </PropertyList>
      )}
    </div>
  )
}
