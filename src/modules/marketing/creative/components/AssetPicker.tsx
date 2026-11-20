import { FileText, ImageOff } from 'lucide-react'
import type { AssetRef } from '@/modules/marketing/creative/types'
import { ASSET_KIND_LABEL } from '@/modules/marketing/creative/types'
import { useBrandAssets } from '@/modules/marketing/creative/hooks'
import { cn } from '@/shared/lib/utils'
import { Checkbox } from '@/shared/components/form/Field'
import { Skeleton } from '@/shared/components/ui/Feedback'

/** Thumbnail of an asset: its image preview, or an icon for files without one. */
export function AssetThumb({ asset, className }: { asset: Pick<AssetRef, 'url' | 'name' | 'kind'>; className?: string }) {
  if (asset.url) {
    return <img src={asset.url} alt="" className={cn('rounded-md border border-line bg-sunken object-contain', className)} loading="lazy" />
  }
  const Icon = asset.kind === 'image' || asset.kind === 'logo' ? ImageOff : FileText
  return (
    <span className={cn('grid place-items-center rounded-md border border-line bg-sunken text-muted', className)} aria-hidden>
      <Icon className="size-5" />
    </span>
  )
}

/** Links brand assets (stored, active ones) to a content item or design request. */
export function AssetPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const query = useBrandAssets({ status: 'active' })
  const list = (query.data ?? []).filter((a) => !a.system)
  if (query.isPending) return <Skeleton className="h-24" />
  if (list.length === 0) return <p className="text-[0.8125rem] text-muted">No brand assets yet. Upload them under Brand assets.</p>
  return (
    <ul aria-label="Brand assets to link" className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
      {list.map((a) => {
        const checked = value.includes(a.id)
        return (
          <li key={a.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover">
              <Checkbox checked={checked} onChange={() => onChange(checked ? value.filter((x) => x !== a.id) : [...value, a.id])} aria-label={a.name} />
              <AssetThumb asset={a} className="size-9 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] text-ink">{a.name}</span>
                <span className="block text-xs text-muted">{ASSET_KIND_LABEL[a.kind]}</span>
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** Read-only list of linked assets. */
export function LinkedAssets({ assets, onOpen }: { assets: AssetRef[]; onOpen?: (id: string) => void }) {
  if (assets.length === 0) return <span className="text-muted">—</span>
  return (
    <ul className="flex flex-wrap gap-2">
      {assets.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpen?.(a.id)} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs hover:bg-hover">
            <AssetThumb asset={a} className="size-6" />
            {a.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
