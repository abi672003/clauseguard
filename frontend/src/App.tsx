import { Suspense, lazy, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';

import AppShell from '@/components/layout/AppShell';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import PageSkeleton from '@/components/ui/PageSkeleton';

const Landing = lazy(() => import('@/pages/Landing'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Contracts = lazy(() => import('@/pages/Contracts'));
const ContractDetail = lazy(() => import('@/pages/ContractDetail'));
const Obligations = lazy(() => import('@/pages/Obligations'));
const ObligationDetail = lazy(() => import('@/pages/ObligationDetail'));
const Review = lazy(() => import('@/pages/Review'));
const Research = lazy(() => import('@/pages/Research'));

/** Per-route error boundary + lazy-loading fallback. Keyed so a new route resets it. */
function RouteFrame({ label, children }: { label: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} label={label}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function NotFound() {
  return (
    <Card title="404">
      <EmptyState
        icon={Compass}
        title="No such screen"
        description="That route does not exist in ClauseGuard."
        action={
          <Link
            to="/dashboard"
            className="text-xs font-medium text-accent underline underline-offset-4"
          >
            Go to the dashboard
          </Link>
        }
      />
    </Card>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RouteFrame label="Landing">
              <Landing />
            </RouteFrame>
          }
        />
        <Route
          path="dashboard"
          element={
            <RouteFrame label="Dashboard">
              <Dashboard />
            </RouteFrame>
          }
        />
        <Route
          path="contracts"
          element={
            <RouteFrame label="Contracts">
              <Contracts />
            </RouteFrame>
          }
        />
        <Route
          path="contracts/:id"
          element={
            <RouteFrame label="Contract">
              <ContractDetail />
            </RouteFrame>
          }
        />
        <Route
          path="obligations"
          element={
            <RouteFrame label="Obligations">
              <Obligations />
            </RouteFrame>
          }
        />
        <Route
          path="obligations/:id"
          element={
            <RouteFrame label="Obligation">
              <ObligationDetail />
            </RouteFrame>
          }
        />
        <Route
          path="review"
          element={
            <RouteFrame label="Review queue">
              <Review />
            </RouteFrame>
          }
        />
        <Route
          path="research"
          element={
            <RouteFrame label="Research">
              <Research />
            </RouteFrame>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
