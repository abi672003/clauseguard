import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/api';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown in the fallback so the user knows which part of the app failed. */
  label?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function describe(error: Error): string {
  if (error instanceof ApiError) {
    return error.isNetworkError
      ? `${error.message}. Is the backend running on port 8000?`
      : `${error.message} (HTTP ${error.status})`;
  }
  return error.message || 'An unexpected error occurred.';
}

/** Route-level boundary: an API failure must never blank the screen. */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the console for debugging; the user gets the card below.
    console.error('[ClauseGuard] render error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback, label } = this.props;

    if (!error) return children;
    if (fallback) return fallback(error, this.reset);

    return (
      <Card title={label ? `${label} failed to render` : 'Something went wrong'}>
        <EmptyState
          tone="error"
          icon={AlertOctagon}
          title={describe(error)}
          description="The rest of ClauseGuard is still available. Retry this view, or pick another screen from the sidebar."
          action={
            <Button variant="primary" onClick={this.reset} iconLeft={<RotateCcw className="h-3.5 w-3.5" />}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }
}
