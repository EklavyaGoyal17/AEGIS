'use client';

import { type ReactNode } from 'react';
import { type LucideIcon, Inbox } from 'lucide-react';
import clsx from 'clsx';

export interface EmptyStateProps {
  /** Icon to display — defaults to Inbox */
  icon?: LucideIcon;
  title: string;
  description: string;
  /** Optional action (e.g. a Button) shown below the description */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={clsx(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-200/50">
        <Icon className="h-6 w-6 text-surface-400" aria-hidden="true" />
      </div>

      <h3 className="text-base font-semibold text-white">{title}</h3>

      <p className="max-w-sm text-sm text-surface-400">{description}</p>

      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
