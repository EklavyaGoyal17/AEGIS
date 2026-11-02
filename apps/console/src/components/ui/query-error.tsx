'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * Shown whenever data could not be loaded. On a security console an outage must never look like an empty
 * queue ("nothing pending") — operators need to know the view is incomplete.
 */
export function QueryError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Unknown error';
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
      <div>
        <p className="font-semibold text-red-100">AEGIS data could not be loaded</p>
        <p className="mt-1 text-red-200/80">{message}</p>
        <p className="mt-1 text-red-200/60">
          This view may be incomplete. Do not assume there is nothing pending.
        </p>
      </div>
    </div>
  );
}
