'use client';

import { type ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'allow' | 'deny' | 'pending' | 'info' | 'expired' | 'default';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  allow:
    'bg-green-500/15 text-green-400 border-green-500/25',
  deny:
    'bg-red-500/15 text-red-400 border-red-500/25',
  pending:
    'bg-amber-500/15 text-amber-400 border-amber-500/25',
  info:
    'bg-blue-500/15 text-blue-400 border-blue-500/25',
  expired:
    'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  default:
    'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      role="status"
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-tight',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
