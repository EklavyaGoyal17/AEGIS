'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  ErrorFallback (functional)                                        */
/* ------------------------------------------------------------------ */

export interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary?: () => void;
  className?: string;
}

export function ErrorFallback({
  error,
  resetErrorBoundary,
  className,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-col items-center gap-4 rounded-lg border border-red-500/30 bg-surface-100 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
        <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-white">
          Something went wrong
        </h3>
        <p className="max-w-md text-sm text-surface-400">
          {error.message || 'An unexpected error occurred.'}
        </p>
      </div>

      {resetErrorBoundary && (
        <button
          type="button"
          onClick={resetErrorBoundary}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors',
            'hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
          )}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try Again
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ErrorBoundary (class component)                                   */
/* ------------------------------------------------------------------ */

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to an error reporting service in production
    console.error('[AEGIS ErrorBoundary]', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          resetErrorBoundary={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}
