import type { ReactNode } from 'react'
import { flexRender, type Column, type Table } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Settings2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Checkbox } from '@/shared/components/form/Field'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuLabel } from '@/shared/components/ui/Menu'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Label for the column picker when `header` isn't a plain string. */
    label?: string
    align?: 'start' | 'end'
    /** Fixed width in px (Attio-like predictable columns). */
    width?: number
    /** Classes added to every body cell of the column. */
    cellClassName?: string
  }
}

interface DataTableProps<T> {
  table: Table<T>
  loading?: boolean
  error?: Error | null
  onRetry?: () => void
  onRowClick?: (row: T) => void
  empty?: ReactNode
  /** Content shown above the table, inside the same frame (filters, search). */
  toolbar?: ReactNode
  /** Shown instead of the toolbar when rows are selected. */
  bulkActions?: (selected: T[]) => ReactNode
  minWidth?: number
  className?: string
}

/** Attio-style data grid: hairline rows, sticky header, sortable columns, pagination. */
export function DataTable<T>({
  table,
  loading,
  error,
  onRetry,
  onRowClick,
  empty,
  toolbar,
  bulkActions,
  minWidth = 880,
  className,
}: DataTableProps<T>) {
  const rows = table.getRowModel().rows
  const selected = table.getSelectedRowModel().rows.map((r) => r.original)
  const showBulk = bulkActions && selected.length > 0

  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-surface', className)}>
      {(toolbar || showBulk) && (
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {showBulk ? (
            <>
              <span className="num text-[0.8125rem] font-medium">{selected.length} selected</span>
              <div className="ms-2 flex items-center gap-1.5">{bulkActions(selected)}</div>
              <Button variant="ghost" size="sm" className="ms-auto" onClick={() => table.resetRowSelection()}>
                Clear
              </Button>
            </>
          ) : (
            toolbar
          )}
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error.message} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        (empty ?? <EmptyState title="Nothing here yet" body="Records will show up here." />)
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.8125rem]" style={{ minWidth }}>
            <thead className="sticky top-0 z-10 bg-sunken/70 backdrop-blur">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-line">
                  {group.headers.map((header) => {
                    const meta = header.column.columnDef.meta
                    const sorted = header.column.getIsSorted()
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        style={meta?.width ? { width: meta.width } : undefined}
                        className={cn(
                          'h-9 px-3 text-xs font-medium whitespace-nowrap text-muted first:ps-4 last:pe-4',
                          meta?.align === 'end' ? 'text-end' : 'text-start',
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              'group inline-flex items-center gap-1 rounded hover:text-ink',
                              meta?.align === 'end' && 'flex-row-reverse',
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === 'asc' ? (
                              <ArrowUp className="size-3 text-ink" aria-hidden />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3 text-ink" aria-hidden />
                            ) : (
                              <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-60" aria-hidden />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b border-line transition-colors last:border-0 hover:bg-hover/60 data-[state=selected]:bg-brand-50/60 dark:data-[state=selected]:bg-brand-500/10',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'h-11 px-3 align-middle first:ps-4 last:pe-4',
                          meta?.align === 'end' && 'text-end',
                          meta?.cellClassName,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && <Pagination table={table} />}
    </div>
  )
}

function Pagination<T>({ table }: { table: Table<T> }) {
  const total = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize } = table.getState().pagination
  const first = pageIndex * pageSize + 1
  const last = Math.min(total, (pageIndex + 1) * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs text-muted">
      <p className="num">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          Rows
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-xs text-ink"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" size="xs" iconOnly aria-label="Previous page" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft />
        </Button>
        <span className="num">
          {pageIndex + 1} / {Math.max(1, table.getPageCount())}
        </span>
        <Button variant="ghost" size="xs" iconOnly aria-label="Next page" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-4 px-4">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ms-auto h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/** "View" menu: show/hide columns. Choices persist via the table's Redux prefs. */
export function ColumnPicker<T>({ table }: { table: Table<T> }) {
  const cols = table.getAllLeafColumns().filter((c) => c.getCanHide())
  return (
    <Menu
      className="w-52"
      trigger={(props) => (
        <Button variant="secondary" size="sm" {...props}>
          <Settings2 />
          View
        </Button>
      )}
    >
      <MenuLabel>Columns</MenuLabel>
      {cols.map((c) => (
        <label key={c.id} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[0.8125rem] hover:bg-hover">
          <Checkbox checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
          {labelOf(c)}
        </label>
      ))}
    </Menu>
  )
}

function labelOf<T>(c: Column<T, unknown>): string {
  const h = c.columnDef.header
  return c.columnDef.meta?.label ?? (typeof h === 'string' ? h : c.id)
}

/** Checkbox column for row selection; put it first in `columns`. */
export function selectColumn<T>() {
  return {
    id: 'select',
    enableSorting: false,
    enableHiding: false,
    meta: { width: 36 },
    header: ({ table }: { table: Table<T> }) => (
      <Checkbox
        aria-label="Select all on this page"
        checked={table.getIsAllPageRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomePageRowsSelected()
        }}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }: { row: { getIsSelected: () => boolean; getToggleSelectedHandler: () => (e: unknown) => void } }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onClick={(e) => e.stopPropagation()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  }
}
