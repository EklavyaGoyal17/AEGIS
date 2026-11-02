'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render as a child element (e.g. wrapping a Next.js Link) */
  asChild?: boolean;
  children: ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Style maps                                                        */
/* ------------------------------------------------------------------ */

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-500/50 active:bg-blue-700',
  danger:
    'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500/50 active:bg-red-700',
  ghost:
    'bg-transparent text-surface-300 hover:bg-surface-200/50 hover:text-white focus-visible:ring-surface-400/50',
  outline:
    'border border-surface-300 bg-transparent text-surface-300 hover:bg-surface-200/30 hover:text-white focus-visible:ring-surface-400/50',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-md px-3 text-xs gap-1.5',
  md: 'h-10 rounded-lg px-4 text-sm gap-2',
  lg: 'h-12 rounded-lg px-6 text-base gap-2.5',
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      asChild = false,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    const classes = clsx(
      'inline-flex items-center justify-center font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
      'disabled:pointer-events-none disabled:opacity-50',
      'select-none',
      variantStyles[variant],
      sizeStyles[size],
      className,
    );

    /*
     * When `asChild` is true the consumer wraps a single child element
     * (e.g. <Link>) and wants it to receive button styling.  We render
     * a plain <span> wrapper instead of <button> so the child controls
     * the actual element rendered.
     */
    if (asChild) {
      return (
        <span className={classes} aria-disabled={isDisabled || undefined}>
          {loading && (
            <Loader2
              className="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
          )}
          {children}
        </span>
      );
    }

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={loading || undefined}
        className={classes}
        {...props}
      >
        {loading && (
          <Loader2
            className="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
