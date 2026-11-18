import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  KeyboardCode,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { cn } from '@/shared/lib/utils'
import { DOT, type Tone } from '@/shared/components/ui/Badge'

export interface KanbanColumn<C extends string> {
  id: C
  label: string
  tone?: Tone
  /** Small summary under the title, e.g. the column's total value (HubSpot style). */
  summary?: ReactNode
  /** Right side of the header, e.g. the stage's win probability. */
  meta?: ReactNode
}

interface KanbanBoardProps<T, C extends string> {
  columns: KanbanColumn<C>[]
  items: T[]
  getId: (item: T) => string
  getColumn: (item: T) => C
  renderCard: (item: T, state: { dragging: boolean; overlay: boolean }) => ReactNode
  /** Called when a card lands on a different column. */
  onMove: (item: T, to: C) => void
  canMove?: boolean
  /** Per-column extra summary computed from its items. */
  summarize?: (items: T[], column: C) => ReactNode
  emptyLabel?: string
  /**
   * When moving isn't allowed (`canMove` false), cards can still be picked up and dropped; this is
   * called instead of `onMove` so the page can say why the move was refused. Without it, cards
   * simply can't be dragged.
   */
  onBlockedMove?: (item: T, to: C) => void
  /**
   * Per-card rule on top of `canMove` (tasks: the server's `canEdit`). A card it refuses is handled
   * like `canMove` false: `onBlockedMove` explains on drop, or the card can't be dragged.
   */
  canMoveItem?: (item: T) => boolean
}

/**
 * Keyboard moves (Space to pick up, arrows, Space to drop). The default getter moves 25 px per key,
 * which never leaves a 20 rem column; Left/Right jump to the previous/next column instead (in visual
 * order, so RTL works too), Up/Down keep small steps inside a column.
 */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const { droppableRects, over, collisionRect } = context
  if (event.code === KeyboardCode.Up) return { ...currentCoordinates, y: currentCoordinates.y - 25 }
  if (event.code === KeyboardCode.Down) return { ...currentCoordinates, y: currentCoordinates.y + 25 }
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return undefined
  event.preventDefault()
  const columns = [...droppableRects.entries()].sort(([, a], [, b]) => a.left - b.left)
  if (columns.length === 0) return undefined
  const centerX = collisionRect ? collisionRect.left + collisionRect.width / 2 : currentCoordinates.x
  let index = over ? columns.findIndex(([id]) => id === over.id) : -1
  if (index < 0) index = columns.findIndex(([, r]) => centerX >= r.left && centerX <= r.left + r.width)
  const nextIndex = Math.min(columns.length - 1, Math.max(0, index + (event.code === KeyboardCode.Right ? 1 : -1)))
  const [, rect] = columns[nextIndex]
  // Coordinates are the dragged card's top-left: center it on the target column.
  const width = collisionRect?.width ?? 0
  return { x: rect.left + rect.width / 2 - width / 2, y: currentCoordinates.y }
}

/** Generic drag-and-drop board. Leads use it for the pipeline; tasks for their status board. */
export function KanbanBoard<T, C extends string>({
  columns,
  items,
  getId,
  getColumn,
  renderCard,
  onMove,
  canMove = true,
  summarize,
  emptyLabel = 'Nothing here',
  onBlockedMove,
  canMoveItem,
}: KanbanBoardProps<T, C>) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    // A small distance lets a click open the card instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  )
  // Not allowed to move, but the page wants to explain why on drop: keep cards draggable.
  const allowed = (item: T) => canMove && (canMoveItem ? canMoveItem(item) : true)
  const draggable = (item: T) => allowed(item) || !!onBlockedMove

  const byColumn = useMemo(() => {
    const map = new Map<C, T[]>(columns.map((c) => [c.id, []]))
    for (const item of items) map.get(getColumn(item))?.push(item)
    return map
  }, [items, columns, getColumn])

  const active = activeId ? items.find((i) => getId(i) === activeId) : undefined

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const item = items.find((i) => getId(i) === e.active.id)
    const to = e.over?.id as C | undefined
    if (!item || !to || to === getColumn(item)) return
    if (allowed(item)) onMove(item, to)
    else onBlockedMove?.(item, to)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full min-h-[28rem] items-stretch gap-2.5">
        {columns.map((col) => {
          const colItems = byColumn.get(col.id) ?? []
          return (
            <Column
              key={col.id}
              column={col}
              count={colItems.length}
              summary={summarize ? summarize(colItems, col.id) : col.summary}
              emptyLabel={emptyLabel}
            >
              {colItems.map((item) => (
                <DraggableCard key={getId(item)} id={getId(item)} disabled={!draggable(item)} hidden={getId(item) === activeId}>
                  {renderCard(item, { dragging: false, overlay: false })}
                </DraggableCard>
              ))}
            </Column>
          )
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
        {active ? <div className="rotate-[1.5deg] cursor-grabbing">{renderCard(active, { dragging: true, overlay: true })}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column<C extends string>({
  column,
  count,
  summary,
  emptyLabel,
  children,
}: {
  column: KanbanColumn<C>
  count: number
  summary?: ReactNode
  emptyLabel: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <section
      aria-label={`${column.label}, ${count}`}
      className={cn(
        'flex w-[20rem] shrink-0 flex-col rounded-card border bg-sunken/70 transition-colors duration-150',
        isOver ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-500/10' : 'border-transparent',
      )}
    >
      <header className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn('size-2 rounded-full', DOT[column.tone ?? 'neutral'])} />
          <h3 className="truncate text-[0.9375rem] font-semibold">{column.label}</h3>
          <span className="num rounded-full border border-line-strong bg-surface px-2 text-xs leading-5 text-muted">{count}</span>
          {column.meta && <span className="num ms-auto text-[0.8125rem] text-muted">{column.meta}</span>}
        </div>
        {summary && <div className="num mt-1 text-[0.8125rem] text-muted">{summary}</div>}
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-2.5">
        {children}
        {count === 0 && (
          <p className="m-1 rounded-md border border-dashed border-line-strong px-3 py-5 text-center text-xs text-subtle">
            {emptyLabel}
          </p>
        )}
      </div>
    </section>
  )
}

function DraggableCard({ id, disabled, hidden, children }: { id: string; disabled: boolean; hidden: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500', hidden && 'opacity-30', !disabled && 'cursor-grab')}
    >
      {children}
    </div>
  )
}

/** Base card surface for board items. */
export function KanbanCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <article
      className={cn(
        'rounded-xl border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-soft',
        className,
      )}
    >
      {children}
    </article>
  )
}
