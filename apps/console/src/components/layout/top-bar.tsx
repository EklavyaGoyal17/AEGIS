'use client';

import clsx from 'clsx';
import { AlertTriangle, Menu, User } from 'lucide-react';
import { useDemoMode } from '@/components/providers';

/* ------------------------------------------------------------------ */
/*  Top Bar                                                            */
/* ------------------------------------------------------------------ */

interface TopBarProps {
  /** Current page title displayed in the bar. */
  title?: string;
  /** Callback fired when the mobile menu hamburger is pressed. */
  onMenuToggle?: () => void;
}

export function TopBar({ title, onMenuToggle }: TopBarProps) {
  const { isDemoMode } = useDemoMode();

  return (
    <header className="sticky top-0 z-20 flex flex-col">
      {/* ---- Demo mode banner ---- */}
      {isDemoMode && (
        <div className="flex items-center justify-center gap-2 bg-amber-600/90 px-4 py-1.5 text-xs font-semibold tracking-wide text-white backdrop-blur">
          <AlertTriangle className="h-3.5 w-3.5" />
          DEMO MODE — Using simulated data
        </div>
      )}

      {/* ---- Main bar ---- */}
      <div className="flex h-14 items-center justify-between border-b border-white/[.06] bg-neutral-950/80 px-4 backdrop-blur-sm lg:px-6">
        {/* Left: hamburger (mobile) + title */}
        <div className="flex items-center gap-3">
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              aria-label="Toggle navigation menu"
              className="rounded-md p-1.5 text-neutral-400 hover:bg-white/[.04] hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          {title && (
            <h1 className="text-base font-semibold text-white">{title}</h1>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-4">
          {/* Data source indicator. Read-only: the source is fixed at build time (NEXT_PUBLIC_DEMO_MODE)
              so the UI can never claim live data while showing simulated data, or vice versa. */}
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              isDemoMode ? 'bg-amber-600/20 text-amber-300' : 'bg-emerald-600/20 text-emerald-300',
            )}
            data-testid="data-source"
          >
            {isDemoMode ? 'Simulated data' : 'Live API'}
          </span>

          {/* Tenant name (demo fixture only; live tenancy comes from the operator's credential) */}
          {isDemoMode && (
            <span className="hidden text-sm font-medium text-neutral-300 md:inline">
              ACME Corp
            </span>
          )}

          {/* User avatar */}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600/20 text-cyan-400"
            aria-label="User account"
          >
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    </header>
  );
}
