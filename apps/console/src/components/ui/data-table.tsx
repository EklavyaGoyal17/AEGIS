'use client';

import { type ReactNode } from 'react';
import clsx from 'clsx';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface DataTableColumn<T> {
  /** Key on the data object */
  key: string;
  /** Column header label */
  header: string;
  /** Custom cell renderer — receives the cell value and the full row */
  render?: (value: unknown, row: T) => ReactNode;
  /** Additional classes for the <th> / <td> */
  className?: string;
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** Show skeleton loading rows */
  loading?: boolean;
  /** Number of skeleton rows to show while loading */
  loadingRows?: number;
  /** Message shown when data is empty and not loading */
  emptyMessage?: string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  loadingRows = 5,
  emptyMessage = 'No data available.',
  onRowClick,
  className,
}: DataTableProps<T>) {
  const isClickable = Boolean(onRowClick);

  return (
    <div
      className={clsx(
        'overflow-x-auto rounded-lg border border-surface-200 bg-surface-100',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">
        {/* ---- Head ---- */}
        <thead>
          <tr className="border-b border-surface-200 bg-surface-200/30">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={clsx(
                  'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-surface-400',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* ---- Body ---- */}
        <tbody className="divide-y divide-surface-200/50">
          {/* Loading state */}
          {loading &&
            Array.from({ length: loadingRows }).map((_, rowIdx) => (
              <tr key={`skel-${rowIdx}`}>
                {columns.map((col) => (
                  <td
                    key={`skel-${rowIdx}-${col.key}`}
                    className={clsx('px-4 py-3', col.className)}
                  >
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}

          {/* Data rows */}
          {!loading &&
            data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={clsx(
                  'text-surface-300 transition-colors',
                  isClickable &&
                    'cursor-pointer hover:bg-surface-200/40 focus-visible:bg-surface-200/40 focus-visible:outline-none',
                )}
              >
                {columns.map((col) => {
                  const value = row[col.key];
                  return (
                    <td
                      key={col.key}
                      className={clsx(
                        'whitespace-nowrap px-4 py-3',
                        col.className,
                      )}
                    >
                      {col.render ? col.render(value, row) : String(value ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>

      {/* Empty state */}
      {!loading && data.length === 0 && (
        <EmptyState
          title="No results"
          description={emptyMessage}
          className="border-t-0"
        />
      )}
    </div>
  );
}
