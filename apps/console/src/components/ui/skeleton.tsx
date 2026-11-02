'use client';

import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Skeleton                                                          */
/* ------------------------------------------------------------------ */

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
  /** Render as a circle (border-radius: 50%) */
  circle?: boolean;
}

export function Skeleton({ width, height, className, circle }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'animate-pulse bg-surface-200/60',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      style={{ width, height }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  SkeletonCard                                                      */
/* ------------------------------------------------------------------ */

export interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'rounded-lg border border-surface-200 bg-surface-100 p-6',
        className,
      )}
    >
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkeletonTable                                                     */
/* ------------------------------------------------------------------ */

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'overflow-hidden rounded-lg border border-surface-200 bg-surface-100',
        className,
      )}
    >
      {/* Header */}
      <div className="flex gap-4 border-b border-surface-200 bg-surface-200/30 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`th-${i}`} className="h-4 flex-1" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={`row-${rowIdx}`}
          className="flex gap-4 border-b border-surface-200/50 px-4 py-3 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton key={`cell-${rowIdx}-${colIdx}`} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
