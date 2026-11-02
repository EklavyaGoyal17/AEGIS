'use client';

import {
  forwardRef,
  useId,
  type SelectHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  /** Visible label above the select */
  label?: string;
  /** Error message displayed below the select */
  error?: string;
  /** Options to populate the dropdown */
  options: SelectOption[];
  /** Placeholder text shown as the first disabled option */
  placeholder?: string;
  /** Override the generated id */
  id?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, options, placeholder, className, id: idProp, ...props },
    ref,
  ) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    const errorId = `${id}-error`;

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

        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={clsx(
              'h-10 w-full appearance-none rounded-lg border bg-surface-100 pl-3 pr-9 text-sm text-white',
              'transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface-0',
              error
                ? 'border-red-500/60 focus:ring-red-500/40'
                : 'border-surface-200 focus:ring-blue-500/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400"
            aria-hidden="true"
          />
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
