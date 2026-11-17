import { useId, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Lock } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface SortableListProps<T extends { _id: string }> {
  items: T[]
  onReorder: (items: T[]) => void
  /** Read-only: no handles, no dragging. */
  disabled?: boolean
  /** Name of an item, for the handle's label and screen-reader announcements. */
  nameOf: (item: T) => string
  /** Renders one row; `handle` is the drag handle to place at its start. */
  renderItem: (item: T, handle: ReactNode, index: number) => ReactNode
  /** Accessible name of the list. */
  label: string
  className?: string
  itemClassName?: (item: T) => string | undefined
  /** Locked rows (protected system items) can't be dragged and keep their position. */
  isLocked?: (item: T) => boolean
}

/**
 * Drag-to-reorder list (dnd-kit). Keyboard: focus a handle, Space to pick up, ↑ / ↓ to move,
 * Space to drop, Escape to cancel. Screen readers hear where the item went.
 */
export function SortableList<T extends { _id: string }>({
  items,
  onReorder,
  disabled,
  nameOf,
  renderItem,
  label,
  className,
  itemClassName,
  isLocked,
}: SortableListProps<T>) {
  const instructionsId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const nameFor = (id: UniqueIdentifier) => {
    const item = items.find((i) => i._id === id)
    return item ? nameOf(item) || 'Untitled' : 'Item'
  }
  const position = (id: UniqueIdentifier | undefined) => (id === undefined ? 0 : items.findIndex((i) => i._id === id) + 1)

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameFor(active.id)}, position ${position(active.id)} of ${items.length}.`,
    onDragOver: ({ active, over }) => (over ? `${nameFor(active.id)} moved to position ${position(over.id)} of ${items.length}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${nameFor(active.id)} dropped at position ${position(over.id)} of ${items.length}.` : `${nameFor(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Reordering cancelled. ${nameFor(active.id)} is back where it was.`,
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i._id === active.id)
    const to = items.findIndex((i) => i._id === over.id)
    if (from < 0 || to < 0) return
    const moved = arrayMove(items, from, to)
    if (!isLocked) return onReorder(moved)
    // Locked rows stay where they are; the others fill the remaining slots in their new order.
    const free = moved.filter((i) => !isLocked(i))
    let k = 0
    onReorder(items.map((i) => (isLocked(i) ? i : free[k++])))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'To reorder, press Space to pick the item up, use the up and down arrow keys to move it, then press Space again to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((i) => i._id)} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul aria-label={label} aria-describedby={instructionsId} className={className}>
          {items.map((item, index) => (
            <SortableRow
              key={item._id}
              id={item._id}
              disabled={disabled}
              locked={isLocked?.(item)}
              name={nameOf(item)}
              className={itemClassName?.(item)}
            >
              {(handle) => renderItem(item, handle, index)}
            </SortableRow>
          ))}
        </ul>
        <span id={instructionsId} className="sr-only">
          Use the grip buttons to reorder.
        </span>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({
  id,
  disabled,
  locked,
  name,
  className,
  children,
}: {
  id: string
  disabled?: boolean
  locked?: boolean
  name: string
  className?: string
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: disabled || locked })
  const handle = locked ? (
    <span className="flex h-8 w-6 shrink-0 items-center justify-center text-subtle" title="Locked: this system item can't be moved">
      <Lock className="size-3.5" aria-hidden />
      <span className="sr-only">Locked</span>
    </span>
  ) : disabled ? (
    <span aria-hidden className="w-6 shrink-0" />
  ) : (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={`Reorder ${name || 'item'}`}
      className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative bg-surface', isDragging && 'z-10 rounded-lg shadow-pop ring-1 ring-line', className)}
    >
      {children(handle)}
    </li>
  )
}
