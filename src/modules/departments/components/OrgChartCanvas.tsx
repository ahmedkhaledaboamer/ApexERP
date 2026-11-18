import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import type { OrgNode } from '@/modules/departments/types'
import { countDescendants, type TreeNode } from '@/modules/departments/lib/tree'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { OrgChartNode } from '@/modules/departments/components/OrgChartNode'

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
const STEP = 1.2
/** Pointer travel (CSS px) before a press becomes a drag, so node clicks keep working. */
const DRAG_THRESHOLD = 5
const KEY_PAN = 48
/** Space kept around the chart when fitting / resetting. */
const PAD = 24
const PRINT_WIDTH = 1020
const PRINT_HEIGHT = 620

/**
 * Connector lines: classic nested-list org chart. Each child <li> draws the horizontal rail to
 * its siblings (::before / ::after) and the stub down to its card; each nested <ul> draws the
 * stem from the parent. Colours come from the theme tokens, so dark mode follows.
 * Print: no transform, the layer is zoomed to fit the page (--oc-print-zoom set before printing)
 * and the chart is forced to light tokens.
 */
const STYLES = `
.oc-children { display: flex; justify-content: center; position: relative; padding-top: 1.5rem; }
.oc-children::before { content: ''; position: absolute; top: 0; left: 50%; height: 1.5rem; border-left: 0.0625rem solid var(--color-line-strong); }
.oc-children > li { position: relative; display: flex; flex-direction: column; align-items: center; padding: 1.5rem 0.625rem 0; }
.oc-children > li::before, .oc-children > li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 1.5rem; border-top: 0.0625rem solid var(--color-line-strong); }
.oc-children > li::after { right: auto; left: 50%; border-left: 0.0625rem solid var(--color-line-strong); }
.oc-children > li:only-child { padding-top: 0; }
.oc-children > li:only-child::before, .oc-children > li:only-child::after { display: none; }
.oc-children > li:first-child::before, .oc-children > li:last-child::after { border: 0 none; }
.oc-children > li:last-child::before { border-right: 0.0625rem solid var(--color-line-strong); border-top-right-radius: 0.5rem; }
.oc-children > li:first-child::after { border-top-left-radius: 0.5rem; }
@media print {
  .oc-viewport { height: auto !important; min-height: 0 !important; overflow: visible !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
  .oc-layer { position: static !important; transform: none !important; transition: none !important; zoom: var(--oc-print-zoom, 1); }
  .oc-layer, .oc-layer * {
    --color-surface: #ffffff; --color-sunken: #f4f4f6; --color-hover: #f1f1f4; --color-line: #ebebef; --color-line-strong: #c9c9d1;
    --color-ink: #18181d; --color-ink-2: #3f3f48; --color-muted: #6e6e7a; --color-subtle: #a1a1ab;
  }
  .oc-card { break-inside: avoid; box-shadow: none !important; }
}
`

export interface OrgChartHandle {
  fit: () => void
  reset: () => void
  centerOn: (id: string) => void
  /** The untransformed chart content (for image export). */
  contentEl: () => HTMLElement | null
  viewportEl: () => HTMLElement | null
}

interface View {
  x: number
  y: number
  k: number
}

interface OrgChartCanvasProps {
  forest: TreeNode<OrgNode>[]
  collapsed: Set<string>
  onToggle: (id: string) => void
  matches: Set<string>
  currentMatch: string | null
  className?: string
  /** Rendered over the canvas (top-start), e.g. a legend. */
  overlay?: ReactNode
}

const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

export const OrgChartCanvas = forwardRef<OrgChartHandle, OrgChartCanvasProps>(function OrgChartCanvas(
  { forest, collapsed, onToggle, matches, currentMatch, className, overlay },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  const [smooth, setSmooth] = useState(false)
  const [dragging, setDragging] = useState(false)

  /** Keeps at least a corner of the chart on screen, whatever the pan. */
  const setView = useCallback((next: View, animate = false) => {
    const vp = viewportRef.current
    const content = contentRef.current
    let { x, y } = next
    const k = clampK(next.k)
    if (vp && content) {
      const keep = 80
      const w = content.offsetWidth * k
      const h = content.offsetHeight * k
      x = Math.min(vp.clientWidth - keep, Math.max(keep - w, x))
      y = Math.min(vp.clientHeight - keep, Math.max(keep - h, y))
    }
    const v = { x, y, k }
    viewRef.current = v
    setSmooth(animate)
    setViewState(v)
  }, [])

  const zoomAt = useCallback(
    (k: number, px: number, py: number, animate = false) => {
      const cur = viewRef.current
      const nk = clampK(k)
      const ratio = nk / cur.k
      setView({ k: nk, x: px - (px - cur.x) * ratio, y: py - (py - cur.y) * ratio }, animate)
    },
    [setView],
  )

  const zoomCentre = useCallback(
    (k: number) => {
      const vp = viewportRef.current
      if (!vp) return
      zoomAt(k, vp.clientWidth / 2, vp.clientHeight / 2, true)
    },
    [zoomAt],
  )

  const reset = useCallback(() => {
    const vp = viewportRef.current
    const content = contentRef.current
    if (!vp || !content) return
    setView({ k: 1, x: (vp.clientWidth - content.offsetWidth) / 2, y: PAD }, true)
  }, [setView])

  const fit = useCallback(() => {
    const vp = viewportRef.current
    const content = contentRef.current
    if (!vp || !content || !content.offsetWidth) return
    const w = content.offsetWidth
    const h = content.offsetHeight
    const k = clampK(Math.min(1, (vp.clientWidth - PAD * 2) / w, (vp.clientHeight - PAD * 2) / h))
    setView({ k, x: (vp.clientWidth - w * k) / 2, y: Math.max(PAD, (vp.clientHeight - h * k) / 2) }, true)
  }, [setView])

  const centerOn = useCallback(
    (id: string) => {
      const vp = viewportRef.current
      const content = contentRef.current
      if (!vp || !content) return
      const el = content.querySelector<HTMLElement>(`[data-oc-id="${CSS_escape(id)}"]`)
      if (!el) return
      const { k } = viewRef.current
      // Untransformed layout offsets up to the layer, so a running zoom transition can't skew it.
      const layer = content.parentElement
      let cx = el.offsetWidth / 2
      let cy = el.offsetHeight / 2
      let cur: HTMLElement | null = el
      while (cur && cur !== layer) {
        cx += cur.offsetLeft
        cy += cur.offsetTop
        cur = cur.offsetParent as HTMLElement | null
      }
      setView({ k, x: vp.clientWidth / 2 - cx * k, y: vp.clientHeight / 2 - cy * k }, true)
    },
    [setView],
  )

  useImperativeHandle(
    ref,
    () => ({ fit, reset, centerOn, contentEl: () => contentRef.current, viewportEl: () => viewportRef.current }),
    [fit, reset, centerOn],
  )

  // First layout: fit a large chart, otherwise show it at 100% centred.
  const placed = useRef(false)
  const hasNodes = forest.length > 0
  useLayoutEffect(() => {
    if (placed.current || !hasNodes) return
    const vp = viewportRef.current
    const content = contentRef.current
    if (!vp || !content) return
    placed.current = true
    if (content.offsetWidth > vp.clientWidth - PAD * 2 || content.offsetHeight > vp.clientHeight - PAD * 2) fit()
    else reset()
    setSmooth(false)
  }, [hasNodes, fit, reset])

  // Printing (menu or Ctrl+P): scale the whole chart to one A4 landscape page.
  useEffect(() => {
    function beforePrint() {
      const content = contentRef.current
      const layer = content?.parentElement
      if (!content || !layer) return
      // A4 landscape minus 12 mm margins ≈ 1030 × 700 CSS px; keep room for the print title.
      const zoom = Math.min(1, PRINT_WIDTH / content.offsetWidth, PRINT_HEIGHT / content.offsetHeight)
      layer.style.setProperty('--oc-print-zoom', String(Math.max(0.1, zoom)))
    }
    window.addEventListener('beforeprint', beforePrint)
    return () => window.removeEventListener('beforeprint', beforePrint)
  }, [])

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms at the cursor;
  // a plain wheel pans. Needs a non-passive listener to stop the page from zooming/scrolling.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = vp!.getBoundingClientRect()
      const cur = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        zoomAt(cur.k * Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        setView({ ...cur, x: cur.x - dx, y: cur.y - dy })
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [zoomAt, setView])

  /* ---- Drag to pan, two-finger pinch to zoom (pointer events) ---- */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null)
  const suppressClick = useRef(false)

  function local(e: { clientX: number; clientY: number }) {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    suppressClick.current = false
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      const v = viewRef.current
      gesture.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const m = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: m.x, my: m.y }
      if (gesture.current) gesture.current.moved = true
      viewportRef.current?.setPointerCapture(e.pointerId)
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const m = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      const cur = viewRef.current
      const nk = clampK(cur.k * (dist / (pinch.current.dist || dist)))
      const ratio = nk / cur.k
      setView({
        k: nk,
        x: m.x - (pinch.current.mx - cur.x) * ratio,
        y: m.y - (pinch.current.my - cur.y) * ratio,
      })
      pinch.current = { dist, mx: m.x, my: m.y }
      return
    }
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    if (!g.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      g.moved = true
      setDragging(true)
      viewportRef.current?.setPointerCapture(e.pointerId)
    }
    setView({ k: viewRef.current.k, x: g.vx + dx, y: g.vy + dy })
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 1 && gesture.current) {
      // Continue as a one-finger pan from the remaining pointer.
      const [p] = [...pointers.current.values()]
      const v = viewRef.current
      gesture.current = { sx: p.x, sy: p.y, vx: v.x, vy: v.y, moved: true }
    }
    if (pointers.current.size === 0) {
      suppressClick.current = !!gesture.current?.moved
      gesture.current = null
      setDragging(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const cur = viewRef.current
    const onCanvas = e.target === e.currentTarget
    if (e.key === '+' || e.key === '=') zoomCentre(cur.k * STEP)
    else if (e.key === '-' || e.key === '_') zoomCentre(cur.k / STEP)
    else if (onCanvas && e.key === '0') reset()
    else if (onCanvas && (e.key === 'f' || e.key === 'F')) fit()
    else if (onCanvas && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? KEY_PAN * 4 : KEY_PAN
      const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0
      const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
      setView({ ...cur, x: cur.x + dx, y: cur.y + dy }, true)
    } else return
    e.preventDefault()
  }

  const pct = Math.round(view.k * 100)

  return (
    <div className={cn('relative', className)}>
      <style>{STYLES}</style>
      <div
        ref={viewportRef}
        tabIndex={0}
        role="group"
        aria-roledescription="zoomable chart"
        aria-label="Company structure chart"
        aria-describedby="oc-help"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault()
            e.stopPropagation()
            suppressClick.current = false
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          // Tabbing to an off-screen card: the browser would scroll this overflow-hidden box and
          // desync it from the transform. Undo that and pan the card into view instead.
          const vp = viewportRef.current
          if (!vp || e.target === vp) return
          vp.scrollLeft = 0
          vp.scrollTop = 0
          const r = e.target.getBoundingClientRect()
          const v = vp.getBoundingClientRect()
          const m = 32
          const dx = r.left < v.left + m ? v.left + m - r.left : r.right > v.right - m ? v.right - m - r.right : 0
          const dy = r.top < v.top + m ? v.top + m - r.top : r.bottom > v.bottom - m ? v.bottom - m - r.bottom : 0
          if (dx || dy) {
            const cur = viewRef.current
            setView({ ...cur, x: cur.x + dx, y: cur.y + dy }, true)
          }
        }}
        className={cn(
          'oc-viewport relative h-full w-full touch-none overflow-hidden rounded-card border border-line bg-canvas select-none',
          'bg-[radial-gradient(var(--color-line-strong)_0.0625rem,transparent_0.0625rem)] bg-[length:1.25rem_1.25rem]',
          'focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div
          dir="ltr" className="oc-layer absolute top-0 left-0 w-max origin-top-left will-change-transform"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transition: smooth ? 'transform 180ms ease-out' : undefined,
          }}
        >
          <div ref={contentRef} className="oc-content flex w-max items-start gap-10 p-6">
            {forest.map((root) => (
              <Branch
                key={root.node.id}
                t={root}
                collapsed={collapsed}
                onToggle={onToggle}
                matches={matches}
                currentMatch={currentMatch}
                root
              />
            ))}
          </div>
        </div>
      </div>

      {overlay && <div className="pointer-events-none absolute start-3 top-3 print:hidden">{overlay}</div>}

      <div className="absolute end-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-pop print:hidden">
        <Button variant="ghost" size="sm" iconOnly aria-label="Zoom out" title="Zoom out (−)" disabled={view.k <= MIN_ZOOM + 0.001} onClick={() => zoomCentre(view.k / STEP)}>
          <Minus />
        </Button>
        <button
          type="button"
          onClick={() => zoomCentre(1)}
          title="Zoom to 100%"
          aria-label={`Zoom ${pct}%. Set to 100%`}
          className="num h-8 w-12 rounded-md text-xs font-medium text-ink-2 hover:bg-hover focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
        >
          {pct}%
        </button>
        <Button variant="ghost" size="sm" iconOnly aria-label="Zoom in" title="Zoom in (+)" disabled={view.k >= MAX_ZOOM - 0.001} onClick={() => zoomCentre(view.k * STEP)}>
          <Plus />
        </Button>
        <span aria-hidden className="mx-0.5 h-5 w-[0.0625rem] bg-line" />
        <Button variant="ghost" size="sm" iconOnly aria-label="Fit to screen" title="Fit to screen (F)" onClick={fit}>
          <Maximize2 />
        </Button>
        <Button variant="ghost" size="sm" iconOnly aria-label="Reset view" title="Reset view (0)" onClick={reset}>
          <RotateCcw />
        </Button>
      </div>

      <p id="oc-help" className="sr-only">
        Drag or use the arrow keys to move the chart. Ctrl or Command plus the mouse wheel, or the plus and minus keys, zoom. F fits the chart, 0
        resets. Press Tab to move between departments and Enter to open one.
      </p>
    </div>
  )
})

function Branch({
  t,
  collapsed,
  onToggle,
  matches,
  currentMatch,
  root = false,
}: {
  t: TreeNode<OrgNode>
  collapsed: Set<string>
  onToggle: (id: string) => void
  matches: Set<string>
  currentMatch: string | null
  root?: boolean
}) {
  const id = t.node.id
  const isCollapsed = collapsed.has(id)
  const card = (
    <OrgChartNode
      node={t.node}
      childCount={t.children.length}
      descendantCount={countDescendants(t)}
      collapsed={isCollapsed}
      onToggle={() => onToggle(id)}
      matched={matches.has(id)}
      current={currentMatch === id}
    />
  )
  const kids =
    !isCollapsed && t.children.length > 0 ? (
      <ul className="oc-children">
        {t.children.map((c) => (
          <li key={c.node.id}>
            <Branch t={c} collapsed={collapsed} onToggle={onToggle} matches={matches} currentMatch={currentMatch} />
          </li>
        ))}
      </ul>
    ) : null
  if (root) {
    return (
      <div className="flex flex-col items-center">
        {card}
        {kids}
      </div>
    )
  }
  return (
    <>
      {card}
      {kids}
    </>
  )
}

/** CSS.escape with a fallback for old engines (ids are plain slugs in practice). */
function CSS_escape(v: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&')
}
