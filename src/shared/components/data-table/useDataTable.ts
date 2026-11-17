import { useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { tablePrefsChanged } from '@/store/tablePrefsSlice'

interface UseDataTableOptions<T> {
  /** Unique id; the user's column, sort and page-size choices are kept in Redux under it. */
  id: string
  data: T[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  /** Free-text filter (usually bound to a search box or the URL). */
  globalFilter?: string
  globalFilterFn?: FilterFn<T>
  defaultHidden?: string[]
  defaultSorting?: SortingState
  defaultPageSize?: number
  enableRowSelection?: boolean
  getRowId?: (row: T) => string
}

function resolve<S>(updater: Updater<S>, prev: S): S {
  return typeof updater === 'function' ? (updater as (p: S) => S)(prev) : updater
}

/**
 * TanStack Table with the app's defaults: client-side sort, filter and pagination;
 * persistent view preferences in Redux (`tablePrefs[id]`); local filters and selection.
 */
export function useDataTable<T>({
  id,
  data,
  columns,
  globalFilter,
  globalFilterFn,
  defaultHidden = [],
  defaultSorting = [],
  defaultPageSize = 25,
  enableRowSelection = false,
  getRowId,
}: UseDataTableOptions<T>) {
  const dispatch = useAppDispatch()
  const prefs = useAppSelector((s) => s.tablePrefs[id])

  const defaultVisibility = useMemo(
    () => Object.fromEntries(defaultHidden.map((c) => [c, false])) as VisibilityState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultHidden.join(',')],
  )
  // Saved choices win, but columns added later keep their default (hidden) state until the user
  // toggles them, so a new hidden-by-default column doesn't appear for people with saved prefs.
  const columnVisibility = useMemo(
    () => ({ ...defaultVisibility, ...(prefs?.columnVisibility ?? {}) }),
    [defaultVisibility, prefs?.columnVisibility],
  )
  const sorting = prefs?.sorting ?? defaultSorting
  const pageSize = prefs?.pageSize ?? defaultPageSize

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [lastFilter, setLastFilter] = useState(globalFilter)
  if (globalFilter !== lastFilter) {
    setLastFilter(globalFilter)
    setPageIndex(0)
  }

  const onVisibility: OnChangeFn<VisibilityState> = (u) =>
    dispatch(tablePrefsChanged({ id, prefs: { columnVisibility: resolve(u, columnVisibility) } }))
  const onSorting: OnChangeFn<SortingState> = (u) =>
    dispatch(tablePrefsChanged({ id, prefs: { sorting: resolve(u, sorting) } }))

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
      rowSelection,
      globalFilter,
      pagination: { pageIndex, pageSize },
    },
    getRowId,
    enableRowSelection,
    onSortingChange: onSorting,
    onColumnVisibilityChange: onVisibility,
    onColumnFiltersChange: (u) => {
      setColumnFilters(u)
      setPageIndex(0)
    },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (u) => {
      const next = resolve(u, { pageIndex, pageSize })
      setPageIndex(next.pageIndex)
      if (next.pageSize !== pageSize) dispatch(tablePrefsChanged({ id, prefs: { pageSize: next.pageSize } }))
    },
    globalFilterFn,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  // Out-of-range pages (after filtering or deleting) snap back to the last page.
  const pageCount = table.getPageCount()
  if (pageIndex > 0 && pageIndex >= pageCount) setPageIndex(Math.max(0, pageCount - 1))

  return table
}
