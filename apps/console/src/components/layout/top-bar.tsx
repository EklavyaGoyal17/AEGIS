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
  const { isDemoMode, setDemoMode } = useDemoMode();

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
          {/* Demo mode toggle */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
            <span className="hidden sm:inline">Demo</span>
            <button
              role="switch"
              aria-checked={isDemoMode}
              aria-label="Toggle demo mode"
              onClick={() => setDemoMode(!isDemoMode)}
              className={clsx(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                isDemoMode ? 'bg-amber-600' : 'bg-neutral-700',
              )}
            >
              <span
                className={clsx(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  isDemoMode ? 'translate-x-[18px]' : 'translate-x-[3px]',
                )}
              />
            </button>
          </label>

          {/* Tenant name */}
          <span className="hidden text-sm font-medium text-neutral-300 md:inline">
            ACME Corp
          </span>

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
