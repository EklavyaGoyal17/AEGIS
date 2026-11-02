'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  Activity,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Plug,
  ScrollText,
  Shield,
} from 'lucide-react';
import { useDemoMode } from '@/components/providers';

/* ------------------------------------------------------------------ */
/*  Navigation Config                                                  */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Agent Activity', href: '/activity', icon: Activity },
  { label: 'Approvals', href: '/approvals', icon: CheckCircle },
  { label: 'Policies', href: '/policies', icon: FileText },
  { label: 'Audit Log', href: '/audit', icon: ScrollText },
  { label: 'Integrations', href: '/integrations', icon: Plug },
];

/* ------------------------------------------------------------------ */
/*  Health Dot                                                         */
/* ------------------------------------------------------------------ */

type HealthStatus = 'healthy' | 'degraded' | 'down';

function HealthDot({
  status,
  collapsed,
}: {
  status: HealthStatus;
  collapsed: boolean;
}) {
  const colors: Record<HealthStatus, string> = {
    healthy: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    down: 'bg-red-500',
  };

  const labels: Record<HealthStatus, string> = {
    healthy: 'All systems operational',
    degraded: 'Degraded performance',
    down: 'System outage',
  };

  return (
    <div className="flex items-center gap-2" aria-label={labels[status]}>
      <span
        className={clsx(
          'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
          colors[status],
        )}
      />
      {!collapsed && (
        <span className="text-xs text-neutral-400">{labels[status]}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const pathname = usePathname();
  const { isDemoMode } = useDemoMode();
  const [collapsed, setCollapsed] = useState(false);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-white/[.06] bg-neutral-950 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
      aria-label="Primary navigation"
    >
      {/* ----- Logo / Wordmark ----- */}
      <div className="flex h-16 items-center gap-2.5 border-b border-white/[.06] px-4">
        <Shield className="h-7 w-7 shrink-0 text-cyan-500" />
        {!collapsed && (
          <span className="text-lg font-semibold tracking-wide text-white">
            AEGIS
          </span>
        )}
      </div>

      {/* ----- Nav Items ----- */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="space-y-1" role="list">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const isActive =
              href === '/' ? pathname === '/' : pathname.startsWith(href);

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                    isActive
                      ? 'bg-cyan-500/10 text-cyan-400'
                      : 'text-neutral-400 hover:bg-white/[.04] hover:text-neutral-200',
                    collapsed && 'justify-center',
                  )}
                >
                  <Icon
                    className={clsx(
                      'h-5 w-5 shrink-0',
                      isActive
                        ? 'text-cyan-400'
                        : 'text-neutral-500 group-hover:text-neutral-300',
                    )}
                  />
                  {!collapsed && <span>{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ----- Bottom Section ----- */}
      <div className="space-y-3 border-t border-white/[.06] px-4 py-4">
        {/* Environment badge */}
        {isDemoMode ? (
          <div
            className={clsx(
              'flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5',
              collapsed && 'justify-center px-1',
            )}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            {!collapsed && (
              <span className="text-xs font-semibold tracking-wide text-amber-400">
                DEMO MODE
              </span>
            )}
          </div>
        ) : (
          <div
            className={clsx(
              'flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1.5',
              collapsed && 'justify-center px-1',
            )}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            {!collapsed && (
              <span className="text-xs font-semibold tracking-wide text-emerald-400">
                LIVE
              </span>
            )}
          </div>
        )}

        {/* Health status */}
        <HealthDot status="healthy" collapsed={collapsed} />

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(
            'flex w-full items-center justify-center rounded-md py-1.5 text-neutral-500 transition-colors hover:bg-white/[.04] hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
