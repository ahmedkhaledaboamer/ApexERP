import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Move, ZoomIn } from 'lucide-react'
import {
  FAVICON_OUTPUT_SIZE,
  IMAGE_LABEL,
  LOGO_ASPECT_MAX,
  LOGO_ASPECT_MIN,
  LOGO_OUTPUT_MAX,
  checkImageBytes,
  maxBytesFor,
  formatBytes,
  type BrandImageKind,
  type ImageInfo,
} from '@/modules/settings/branding'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'

/** Display box of the crop frame (CSS px); the output size is computed from the source pixels. */
const FRAME_W = 432
const FRAME_H = 240
const ZOOM_MAX = 4

export interface CropSource {
  /** Object URL of the picked raster file. */
  src: string
  name: string
}

interface Props {
  kind: BrandImageKind
  source: CropSource | null
  onCancel: () => void
  onApply: (dataUrl: string, info: ImageInfo) => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The crop frame for an aspect, as large as fits `maxW` × FRAME_H. */
function frameFor(aspect: number, maxW: number): { w: number; h: number } {
  const W = Math.max(120, Math.min(FRAME_W, maxW))
  return aspect >= W / FRAME_H ? { w: W, h: Math.round(W / aspect) } : { w: Math.round(FRAME_H * aspect), h: FRAME_H }
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * Crop before saving (raster logos and favicons): the image is drawn on a canvas inside the crop
 * frame; drag (or arrow keys) to pan, the slider to zoom. Logos pick a frame from 1:2 to 4:1
 * (starting at the image's own shape), favicons are square. The output is a PNG (WebP when the PNG
 * would exceed the limit) scaled down to at most 800×400 (logo) or 128×128 (favicon).
 */
export function CropDialog({ kind, source, onCancel, onApply }: Props) {
  const favicon = kind === 'favicon'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1)
  const [zoom, setZoom] = useState(1)
  /** Image top-left inside the frame, in frame px. */
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  // The frame fits the dialog width (phones included).
  const [boxW, setBoxW] = useState(FRAME_W)
  const observer = useRef<ResizeObserver | null>(null)
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = () => setBoxW(Math.floor(el.clientWidth - 24))
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(el)
  }, [])

  // Load the picked file.
  useEffect(() => {
    setImg(null)
    setLoadError(null)
    setError(null)
    if (!source) return
    const el = new Image()
    let alive = true
    el.onload = () => {
      if (!alive) return
      const natural = el.naturalWidth / Math.max(1, el.naturalHeight)
      setAspect(favicon ? 1 : clamp(Math.round(natural * 20) / 20, LOGO_ASPECT_MIN, LOGO_ASPECT_MAX))
      setZoom(1)
      setImg(el)
    }
    el.onerror = () => alive && setLoadError('This image can’t be opened by the browser. Export it again as PNG or JPG.')
    el.src = source.src
    return () => {
      alive = false
    }
  }, [source, favicon])

  const frame = useMemo(() => frameFor(aspect, boxW), [aspect, boxW])
  const scale = img ? Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight) * zoom : 1
  const dw = img ? img.naturalWidth * scale : 0
  const dh = img ? img.naturalHeight * scale : 0

  const clampPos = useCallback((p: { x: number; y: number }) => ({ x: clamp(p.x, frame.w - dw, 0), y: clamp(p.y, frame.h - dh, 0) }), [frame, dw, dh])

  // Centre the image whenever the frame or the image changes; keep the centre when zooming.
  const centred = useRef<{ w: number; h: number; img: HTMLImageElement | null }>({ w: 0, h: 0, img: null })
  const prevScale = useRef(scale)
  useEffect(() => {
    if (!img) return
    if (centred.current.img !== img || centred.current.w !== frame.w || centred.current.h !== frame.h) {
      centred.current = { w: frame.w, h: frame.h, img }
      setPos({ x: (frame.w - dw) / 2, y: (frame.h - dh) / 2 })
    } else if (prevScale.current !== scale) {
      const k = scale / prevScale.current
      setPos((p) => clampPos({ x: frame.w / 2 - (frame.w / 2 - p.x) * k, y: frame.h / 2 - (frame.h / 2 - p.y) * k }))
    }
    prevScale.current = scale
  }, [img, frame, dw, dh, scale, clampPos])

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(frame.w * dpr)
    canvas.height = Math.round(frame.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Checkerboard: shows transparency.
    const cell = 8
    for (let y = 0; y < frame.h; y += cell) {
      for (let x = 0; x < frame.w; x += cell) {
        ctx.fillStyle = ((x + y) / cell) % 2 === 0 ? '#ffffff' : '#e4e4e7'
        ctx.fillRect(x, y, cell, cell)
      }
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, pos.x, pos.y, dw, dh)
  }, [img, frame, pos, dw, dh])

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const d = drag.current
    if (!d) return
    setPos(clampPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }))
  }
  function onPointerUp() {
    drag.current = null
  }
  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const step = e.shiftKey ? 40 : 10
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = move[e.key]
    if (!m) return
    e.preventDefault()
    setPos((p) => clampPos({ x: p.x + m[0], y: p.y + m[1] }))
  }

  async function apply() {
    if (!img) return
    setBusy(true)
    setError(null)
    try {
      // Source rectangle in image pixels.
      const sx = -pos.x / scale
      const sy = -pos.y / scale
      const sw = frame.w / scale
      const sh = frame.h / scale
      let outW: number
      let outH: number
      if (favicon) {
        outW = outH = Math.max(16, Math.min(FAVICON_OUTPUT_SIZE, Math.round(sw)))
      } else {
        outW = Math.min(LOGO_OUTPUT_MAX.width, Math.round(sw))
        outH = Math.round(outW / aspect)
        if (outH > LOGO_OUTPUT_MAX.height) {
          outH = LOGO_OUTPUT_MAX.height
          outW = Math.round(outH * aspect)
        }
      }
      const out = document.createElement('canvas')
      out.width = Math.max(1, outW)
      out.height = Math.max(1, outH)
      const ctx = out.getContext('2d')
      if (!ctx) throw new Error('Your browser can’t crop images here.')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height)

      const max = maxBytesFor(kind)
      let blob = await blobOf(out, 'image/png')
      if (blob && blob.size > max) {
        const webp = await blobOf(out, 'image/webp', 0.9)
        if (webp && webp.type === 'image/webp') blob = webp
      }
      if (!blob) throw new Error('The crop couldn’t be saved as an image.')
      if (blob.size > max) throw new Error(`The cropped ${IMAGE_LABEL[kind]} is still ${formatBytes(blob.size)}; the limit is ${formatBytes(max)}. Crop a smaller area.`)
      const checked = checkImageBytes(kind, blob.type === 'image/webp' ? 'webp' : 'png', await bytesOf(blob))
      if (!checked.ok) throw new Error(checked.message)
      onApply(await readDataUrl(blob), checked.info)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The crop failed.')
    } finally {
      setBusy(false)
    }
  }

  const ratioLabel = aspect >= 1 ? `${Number(aspect.toFixed(2))}:1` : `1:${Number((1 / aspect).toFixed(2))}`

  return (
    <Modal
      open={!!source}
      onClose={() => !busy && onCancel()}
      title={favicon ? 'Crop the favicon' : `Crop the ${IMAGE_LABEL[kind]}`}
      description={
        favicon
          ? 'Square, shown at 16–32 px in the browser tab. Saved at up to 128×128.'
          : 'Drag to position, zoom to fit. Wide logos up to 4:1 work best. Saved at up to 800×400.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button id="crop-apply" onClick={apply} loading={busy} disabled={!img}>
            Apply crop
          </Button>
        </>
      }
    >
      <div id="crop-dialog" data-kind={kind} className="space-y-4">
        {loadError ? (
          <p role="alert" className="text-[0.8125rem] text-danger-600 dark:text-danger-500">
            {loadError}
          </p>
        ) : (
          <div ref={boxRef} className="grid place-items-center overflow-hidden rounded-lg border border-line bg-sunken p-3" style={{ minHeight: FRAME_H + 24 }}>
            <canvas
              id="crop-canvas"
              ref={canvasRef}
              tabIndex={0}
              role="img"
              aria-label={`Crop area ${ratioLabel}. Drag or use the arrow keys to move the image.`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className="cursor-grab touch-none rounded-sm shadow-[0_0_0_1px_var(--color-line-strong)] outline-none focus-visible:shadow-[var(--shadow-focus)] active:cursor-grabbing"
              style={{ width: frame.w, height: frame.h }}
            />
          </div>
        )}

        <label className="flex items-center gap-3 text-[0.8125rem] text-ink-2">
          <ZoomIn className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="w-12 shrink-0">Zoom</span>
          <input
            id="crop-zoom"
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            disabled={!img}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[var(--color-brand-600)]"
          />
          <span className="num w-12 text-end text-xs text-muted">{Math.round(zoom * 100)}%</span>
        </label>
        {!favicon && (
          <label className="flex items-center gap-3 text-[0.8125rem] text-ink-2">
            <Move className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="w-12 shrink-0">Shape</span>
            <input
              id="crop-aspect"
              type="range"
              min={LOGO_ASPECT_MIN}
              max={LOGO_ASPECT_MAX}
              step={0.05}
              value={aspect}
              disabled={!img}
              onChange={(e) => setAspect(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[var(--color-brand-600)]"
            />
            <span className="num w-12 text-end text-xs text-muted">{ratioLabel}</span>
          </label>
        )}
        {error && (
          <p role="alert" id="crop-error" className="text-[0.8125rem] text-danger-600 dark:text-danger-500">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
