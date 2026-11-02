'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
} from 'react';
import clsx from 'clsx';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Visible label above the input */
  label?: string;
  /** Error message displayed below the input */
  error?: string;
  /** Helper text displayed below the input (hidden when error is present) */
  helperText?: string;
  /** Override the generated id */
  id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id: idProp, ...props }, ref) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    const errorId = `${id}-error`;
    const helperId = `${id}-helper`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={id}
            className="text-sm font-medium text-surface-300"
          >
            {label}
          </label>
        )}

        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? errorId : helperText ? helperId : undefined
          }
          className={clsx(
            'h-10 w-full rounded-lg border bg-surface-100 px-3 text-sm text-white placeholder-surface-500',
            'transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface-0',
            error
              ? 'border-red-500/60 focus:ring-red-500/40'
              : 'border-surface-200 focus:ring-blue-500/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}

        {!error && helperText && (
          <p id={helperId} className="text-xs text-surface-500">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
