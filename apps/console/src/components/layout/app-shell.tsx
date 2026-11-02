'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';

/* ------------------------------------------------------------------ */
/*  App Shell                                                          */
/* ------------------------------------------------------------------ */

interface AppShellProps {
  children: React.ReactNode;
  /** Page title shown in the top bar. */
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = useCallback(
    () => setMobileMenuOpen((v) => !v),
    [],
  );

  // Close mobile menu on route change (viewport resize)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileMenuOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* ---- Desktop sidebar ---- */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* ---- Mobile sidebar overlay ---- */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={toggleMobileMenu}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden">
            <Sidebar />
            <button
              onClick={toggleMobileMenu}
              aria-label="Close navigation menu"
              className="absolute right-2 top-4 z-40 rounded-md p-1 text-neutral-400 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </>
      )}

      {/* ---- Content area ---- */}
      <div
        className={clsx(
          'flex flex-1 flex-col overflow-hidden transition-[margin] duration-200',
          'lg:ml-64', // push content past sidebar on desktop
        )}
      >
        <TopBar title={title} onMenuToggle={toggleMobileMenu} />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
