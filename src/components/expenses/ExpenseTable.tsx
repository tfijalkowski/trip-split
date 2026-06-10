import { useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState,
} from "@tanstack/react-table";
import type { ExpenseWithParticipants, GroupMember } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface Props {
  expenses: ExpenseWithParticipants[];
  members: GroupMember[];
}

const columnHelper = createColumnHelper<ExpenseWithParticipants>();

export function ExpenseTable({ expenses, members }: Props) {
  const memberMap = new Map(members.map((m) => [m.user_id, m]));

  const [sorting, setSorting] = useState<SortingState>([{ id: "expense_date", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const columns = [
    columnHelper.accessor("description", {
      header: "Description",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("amount", {
      header: "Amount",
      cell: (info) => `${(info.getValue() / 100).toFixed(2)} PLN`,
    }),
    columnHelper.accessor("expense_date", {
      header: "Date",
      cell: (info) => {
        const val = info.getValue() ?? info.row.original.created_at;
        return new Date(val).toLocaleDateString();
      },
    }),
    columnHelper.accessor("paid_by", {
      header: "Paid by",
      filterFn: (row, _id, filterValue: string) => row.original.paid_by === filterValue,
      cell: (info) => {
        const m = memberMap.get(info.getValue());
        return m?.display_name ?? m?.email ?? info.getValue();
      },
    }),
  ];

  const table = useReactTable({
    data: expenses,
    columns,
    state: { sorting, columnFilters, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-white/50 uppercase">Expenses</p>
        <select
          className="rounded bg-black/20 px-2 py-1 text-sm text-white/80"
          value={(table.getColumn("paid_by")?.getFilterValue() as string | undefined) ?? ""}
          onChange={(e) => {
            table.getColumn("paid_by")?.setFilterValue(e.target.value || undefined);
          }}
        >
          <option value="">All payers</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name ?? m.email}
            </option>
          ))}
        </select>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="cursor-pointer text-white/50 select-none"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" ? " ↑" : header.column.getIsSorted() === "desc" ? " ↓" : ""}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-white/40">
                No expenses yet
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="text-white/80">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="mt-3 flex items-center justify-between text-sm text-white/50">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              table.previousPage();
            }}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              table.nextPage();
            }}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
        <span>
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <select
          className="rounded bg-black/20 px-2 py-1 text-sm text-white/80"
          value={table.getState().pagination.pageSize}
          onChange={(e) => {
            table.setPageSize(Number(e.target.value));
          }}
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
