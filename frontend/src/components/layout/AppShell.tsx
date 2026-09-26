import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Cpu,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import Skeleton from '@/components/ui/Skeleton';
import { getHealth } from '@/lib/api';
import { cn, formatPct } from '@/lib/format';

const COLLAPSE_KEY = 'clauseguard:nav-collapsed';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: ShieldCheck, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contracts', label: 'Contracts', icon: FileText },
  { to: '/obligations', label: 'Obligations', icon: ListChecks },
  { to: '/review', label: 'Review', icon: ClipboardCheck },
  { to: '/research', label: 'Research', icon: FlaskConical },
];

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ health pill */
function HealthPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1,
  });

  if (isPending) {
    return <Skeleton className="h-7 w-44" rounded="full" />;
  }

  if (isError || !data) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ungrounded-rgb)/0.4)] bg-[rgb(var(--ungrounded-rgb)/0.12)] px-3 py-1 text-[11px] font-medium text-ungrounded"
      >
        <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
        API unreachable
      </span>
    );
  }

  const models = Object.values(data.models_loaded);
  const loaded = models.filter(Boolean).length;
  const ok = data.status === 'ok';

  return (
    <span
      role="status"
      title={`v${data.version} · ${data.env} · threshold ${formatPct(data.entailment_threshold)}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-muted"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          ok ? 'bg-grounded animate-pulse-glow' : 'bg-uncertain',
        )}
      />
      <span className={cn('font-medium', ok ? 'text-grounded' : 'text-uncertain')}>
        {ok ? 'Online' : 'Degraded'}
      </span>

      <span aria-hidden="true" className="h-3 w-px bg-border" />

      <span className="hidden items-center gap-1 font-mono uppercase tabular-nums sm:inline-flex">
        <Cpu aria-hidden="true" className="h-3 w-3" />
        {data.device}
      </span>

      <span
        className="font-mono tabular-nums"
        title={Object.entries(data.models_loaded)
          .map(([name, isLoaded]) => `${name}: ${isLoaded ? 'loaded' : 'cold'}`)
          .join(' · ')}
      >
        {loaded}/{models.length} models
      </span>

      <span
        className={cn('hidden font-mono md:inline', data.llm_agent ? 'text-accent' : 'text-muted')}
      >
        agent:{data.llm_agent ? 'llm' : 'rules'}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- shell */
export default function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // storage blocked — the shell still works, the preference just won't stick
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  return (
    <div className="min-h-dvh bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-accent focus:bg-bg-elev focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to content
      </a>

      {/* fixed left nav — icon rail below lg, icon+label above */}
      <aside
        aria-label="Primary"
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-bg-elev',
          'w-[68px] transition-[width] duration-240 ease-instrument',
          collapsed ? 'lg:w-[68px]' : 'lg:w-[244px]',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-accent" />
          <span
            className={cn(
              'truncate text-sm font-semibold tracking-tight',
              collapsed ? 'hidden' : 'hidden lg:inline',
            )}
          >
            ClauseGuard
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-240 ease-instrument',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  isActive
                    ? 'bg-[rgb(var(--accent-rgb)/0.14)] text-accent'
                    : 'text-muted hover:bg-surface hover:text-text',
                )
              }
            >
              <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              <span className={cn('truncate', collapsed ? 'hidden' : 'hidden lg:inline')}>
                {label}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors duration-240 ease-instrument hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            )}
            <span className={cn('truncate', collapsed && 'hidden')}>Collapse</span>
          </button>
        </div>
      </aside>

      <div
        className={cn(
          'flex min-h-dvh flex-col pl-[68px] transition-[padding] duration-240 ease-instrument',
          collapsed ? 'lg:pl-[68px]' : 'lg:pl-[244px]',
        )}
      >
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-[rgb(var(--bg-rgb)/0.82)] px-3 backdrop-blur-xl sm:px-5">
          <p className="min-w-0 truncate text-xs text-muted">
            Contract obligations,{' '}
            <span className="text-text">re-checked against their source clause</span>
          </p>
          <HealthPill />
        </header>

        <main id="main" className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
