import { useEffect, useRef, useState } from 'react'
import { ImageUp, Trash2 } from 'lucide-react'
import {
  ACCEPT_ATTR,
  ALLOWED_TYPES_TEXT,
  IMAGE_LABEL,
  checkImageBytes,
  declaredType,
  describeImageUrl,
  formatBytes,
  maxBytesFor,
  toDataUrl,
  MIME_OF,
  type BrandImageKind,
  type ImageInfo,
} from '@/modules/settings/branding'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { CropDialog, type CropSource } from './CropDialog'

interface Props {
  kind: BrandImageKind
  title: string
  hint: string
  /** Current (draft) image URL, or null. */
  value: string | null
  /** The tile the image is shown on. */
  surface: 'light' | 'dark'
  disabled: boolean
  onChange: (dataUrl: string | null, info: ImageInfo | null) => void
}

/**
 * One branding image: preview tile, Upload / Replace and Remove (with confirm). The picked file is
 * checked on the client with the same rules as the server (type, size, real content, SVG safety);
 * raster images then go through the crop dialog, SVGs are shown as they are (preview only).
 */
export function ImageField({ kind, title, hint, value, surface, disabled, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [crop, setCrop] = useState<CropSource | null>(null)
  const [svg, setSvg] = useState<{ dataUrl: string; info: ImageInfo } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const label = IMAGE_LABEL[kind]
  const max = maxBytesFor(kind)
  const id = `branding-${kind}`

  // Release the object URL of a finished crop.
  useEffect(() => () => {
    if (crop) URL.revokeObjectURL(crop.src)
  }, [crop])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    const declared = declaredType(file.type, file.name)
    if (!declared) return setError(`The ${label} must be a ${ALLOWED_TYPES_TEXT} image. “${file.name}” isn’t one.`)
    if (file.size > max) return setError(`The ${label} is ${formatBytes(file.size)}; the limit is ${formatBytes(max)}.`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const checked = checkImageBytes(kind, declared, bytes)
    if (!checked.ok) return setError(checked.message)
    if (declared === 'svg') setSvg({ dataUrl: toDataUrl(MIME_OF.svg, bytes), info: checked.info })
    else setCrop({ src: URL.createObjectURL(file), name: file.name })
  }

  const summary = describeImageUrl(value)
  const tile = surface === 'dark' ? 'dark bg-[#18181b]' : 'bg-white'

  return (
    <div id={id} data-has-image={value ? 'true' : 'false'} className="min-w-0 space-y-3">
      <div>
        <p className="text-[0.8125rem] font-medium text-ink">{title}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div
        id={`${id}-preview`}
        className={cn('grid h-24 place-items-center rounded-lg border border-line px-4', tile, kind === 'favicon' && 'h-24')}
      >
        {value ? (
          <img
            src={value}
            alt={`Current ${label}`}
            className={cn('max-h-16 max-w-full object-contain', kind === 'favicon' && 'size-12')}
          />
        ) : (
          <span className={cn('text-xs', surface === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
            {kind === 'logoDark' ? 'Uses the light logo' : kind === 'favicon' ? 'Uses the Apex CRM icon' : 'Monogram'}
          </span>
        )}
      </div>
      <p className="truncate text-xs text-muted" id={`${id}-summary`}>
        {summary ?? 'Not set'}
      </p>
      <input
        ref={input}
        id={`${id}-input`}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload the ${label}`}
        disabled={disabled}
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button id={`${id}-upload`} size="sm" variant="secondary" write onClick={() => input.current?.click()}>
            <ImageUp />
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button id={`${id}-remove`} size="sm" variant="ghost" write onClick={() => setConfirmRemove(true)}>
              <Trash2 />
              Remove
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" id={`${id}-error`} className="text-xs text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}

      <CropDialog
        kind={kind}
        source={crop}
        onCancel={() => setCrop(null)}
        onApply={(dataUrl, info) => {
          setCrop(null)
          onChange(dataUrl, info)
        }}
      />

      <Modal
        open={!!svg}
        onClose={() => setSvg(null)}
        size="sm"
        title={`Use this SVG as the ${label}?`}
        description="SVGs are used as uploaded (no cropping). Scripts, links and embedded content are not allowed."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSvg(null)}>
              Cancel
            </Button>
            <Button
              id="svg-apply"
              onClick={() => {
                if (svg) onChange(svg.dataUrl, svg.info)
                setSvg(null)
              }}
            >
              Use SVG
            </Button>
          </>
        }
      >
        {svg && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid h-28 place-items-center rounded-lg border border-line bg-white p-3">
              <img src={svg.dataUrl} alt="SVG on a light background" className="max-h-20 max-w-full object-contain" />
            </div>
            <div className="grid h-28 place-items-center rounded-lg border border-line bg-[#18181b] p-3">
              <img src={svg.dataUrl} alt="SVG on a dark background" className="max-h-20 max-w-full object-contain" />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        size="sm"
        title={`Remove the ${label}?`}
        description={
          kind === 'logoLight'
            ? 'The monogram shows instead (and in dark mode too, unless a dark logo is set). Saved when you save the branding.'
            : kind === 'logoDark'
              ? 'Dark mode uses the light logo instead. Saved when you save the branding.'
              : 'The browser tab shows the Apex CRM icon instead. Saved when you save the branding.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button
              id="branding-remove-confirm"
              variant="danger"
              onClick={() => {
                setConfirmRemove(false)
                onChange(null, null)
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">You can upload it again at any time.</p>
      </Modal>
    </div>
  )
}
