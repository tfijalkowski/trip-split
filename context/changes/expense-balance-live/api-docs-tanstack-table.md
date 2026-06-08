---
change_id: expense-balance-live
type: api-docs
library: "@tanstack/react-table"
version: v8 stable
source: Context7 /websites/tanstack_table (tanstack.com/table/latest)
fetched: 2026-06-08
updated: 2026-06-08
---

# API Docs: TanStack Table v8 — S-02 Expense List

> v8 stable API sourced from tanstack.com/table/latest official docs.
> Install: `npm install @tanstack/react-table` (v8.21+ for React 19 support).

## Imports

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  PaginationState,
} from '@tanstack/react-table'
```

## Column definition

Two valid patterns in v8 — pick one:

**A) `ColumnDef` array (official examples style):**

```tsx
const columns = React.useMemo<ColumnDef<Expense>[]>(
  () => [
    { accessorKey: 'description', header: 'Description', cell: info => info.getValue() },
    { accessorKey: 'amount',      header: 'Amount',      cell: info => info.getValue() },
    { accessorKey: 'date',        header: 'Date',        cell: info => info.getValue() },
    { accessorKey: 'paid_by',     header: 'Paid by',     cell: info => info.getValue() },
  ],
  [],
)
```

**B) `createColumnHelper` (more type-safe):**

```tsx
import { createColumnHelper } from '@tanstack/react-table'

const columnHelper = createColumnHelper<Expense>()

const columns = [
  columnHelper.accessor('description', { header: 'Description', cell: info => info.getValue() }),
  columnHelper.accessor('amount',      { header: 'Amount',      cell: info => info.getValue() }),
  columnHelper.accessor('date',        { header: 'Date',        cell: info => info.getValue() }),
  columnHelper.accessor('paid_by',     { header: 'Paid by',     cell: info => info.getValue() }),
]
```

## Table instance — client-side (all three features)

```tsx
const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
const [sorting, setSorting]             = React.useState<SortingState>([{ id: 'date', desc: true }])
const [pagination, setPagination]       = React.useState<PaginationState>({
  pageIndex: 0,
  pageSize: 20,
})

const table = useReactTable({
  data,          // Expense[] — updated by Realtime events
  columns,
  getCoreRowModel:       getCoreRowModel(),
  getFilteredRowModel:   getFilteredRowModel(),
  getSortedRowModel:     getSortedRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  // no need to pass pageCount with client-side pagination — calculated automatically
  state: { columnFilters, sorting, pagination },
  onColumnFiltersChange: setColumnFilters,
  onSortingChange:       setSorting,
  onPaginationChange:    setPagination,
  // autoResetPageIndex: false, // keep page index when sorting or filtering
})
```

## Table instance — server-side pagination (Supabase `.range()`)

```tsx
const table = useReactTable({
  data,
  columns,
  getCoreRowModel:     getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getSortedRowModel:   getSortedRowModel(),
  manualPagination:    true,
  rowCount:            totalCount,  // from Supabase count: 'estimated'
  state: { columnFilters, sorting, pagination },
  onColumnFiltersChange: setColumnFilters,
  onSortingChange:       setSorting,
  onPaginationChange:    setPagination,
})
```

## Header row with sort + optional column filter

```tsx
{table.getHeaderGroups().map(headerGroup => (
  <tr key={headerGroup.id}>
    {headerGroup.headers.map(header => (
      <th key={header.id}>
        {header.isPlaceholder ? null : (
          <>
            <div
              className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
              onClick={header.column.getToggleSortingHandler()}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {{ asc: ' 🔼', desc: ' 🔽' }[header.column.getIsSorted() as string] ?? null}
            </div>
            {header.column.getCanFilter() ? (
              <input
                value={(header.column.getFilterValue() as string) ?? ''}
                onChange={e => header.column.setFilterValue(e.target.value)}
                placeholder={`Filter ${header.id}...`}
              />
            ) : null}
          </>
        )}
      </th>
    ))}
  </tr>
))}
```

## Body rows

```tsx
{table.getRowModel().rows.map(row => (
  <tr key={row.id}>
    {row.getVisibleCells().map(cell => (
      <td key={cell.id}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </td>
    ))}
  </tr>
))}
```

## Filter input — standalone (by payer / participant)

```tsx
<input
  value={(table.getColumn('paid_by')?.getFilterValue() as string) ?? ''}
  onChange={e => table.getColumn('paid_by')?.setFilterValue(e.target.value)}
  placeholder="Filter by person..."
/>
```

## Pagination controls

```tsx
<button onClick={() => table.firstPage()}    disabled={!table.getCanPreviousPage()}>{'<<'}</button>
<button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>{'<'}</button>
<button onClick={() => table.nextPage()}     disabled={!table.getCanNextPage()}>{'>'}</button>
<button onClick={() => table.lastPage()}     disabled={!table.getCanNextPage()}>{'>>'}</button>

<span>
  Page <strong>
    {table.getState().pagination.pageIndex + 1} of {table.getPageCount().toLocaleString()}
  </strong>
</span>

<select
  value={table.getState().pagination.pageSize}
  onChange={e => table.setPageSize(Number(e.target.value))}
>
  {[10, 20, 50].map(size => (
    <option key={size} value={size}>Show {size}</option>
  ))}
</select>
```

## S-02 requirement → TanStack v8 feature mapping

| S-02 requirement | TanStack v8 |
|---|---|
| Paginated expense list | `getPaginationRowModel()` (client) or `manualPagination: true` + `rowCount` (server) |
| Filter by participant | `getFilteredRowModel()` + `setFilterValue()` on `paid_by` column |
| Sort by date (default desc) | `getSortedRowModel()` + initial `sorting` state `[{ id: 'date', desc: true }]` |
