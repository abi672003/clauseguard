/**
 * The shell every ClauseGuard 3D scene renders inside.
 *
 * It owns the four things no individual scene should re-implement:
 *  - WebGL availability detection, with a 2D fallback when there is none;
 *  - the fixed renderer settings from the brief (`dpr` capped at 1.75,
 *    antialiasing, high-performance GPU hint);
 *  - `<Suspense>` plus a shimmer skeleton until the first frame is drawn,
 *    and an error boundary so a scene failure never blanks a route;
 *  - `prefers-reduced-motion`, which switches the render loop to `demand` and
 *    is published to the scene through `useSceneMotion()` so animation freezes
 *    on a composed still instead of stopping mid-sweep.
 */
import { Canvas, useThree, type CanvasProps } from '@react-three/fiber';
import { Boxes, TriangleAlert } from 'lucide-react';
import {
  Component,
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';

import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/format';

/* ------------------------------------------------------- reduced motion */
const ReducedMotionContext = createContext(false);

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Tracks `prefers-reduced-motion`, including changes made while mounted. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Read inside a scene (i.e. inside the Canvas) to decide whether to animate.
 * A frozen scene should sample `FROZEN_TIME` rather than the clock.
 */
export function useSceneMotion(): boolean {
  return useContext(ReducedMotionContext);
}

/**
 * Redraws once per React render. Needed because a reduced-motion canvas runs
 * `frameloop="demand"`, so prop-driven scenes (PipelineFlow) must ask for the
 * frame their new props imply.
 */
export function useSceneRefresh(): void {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  });
}

/* ------------------------------------------------------------ detection */
let webglSupport: boolean | null = null;

/** Cached one-shot WebGL probe; the probe context is released immediately. */
export function isWebGLAvailable(): boolean {
  if (webglSupport !== null) return webglSupport;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const context =
      probe.getContext('webgl2') ??
      probe.getContext('webgl') ??
      probe.getContext('experimental-webgl');
    webglSupport = Boolean(context);
    if (context && 'getExtension' in context) {
      (context as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/* ------------------------------------------------------- error boundary */
interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}

interface BoundaryState {
  failed: boolean;
}

class SceneErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[three] scene failed to render', error, info.componentStack);
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* --------------------------------------------------------------- pieces */
export interface SceneFallbackProps {
  title: string;
  description: string;
  tone?: 'neutral' | 'error';
  className?: string;
}

/** The flat panel shown instead of a canvas. Never a blank rectangle. */
export function SceneFallback({ title, description, tone = 'neutral', className }: SceneFallbackProps) {
  return (
    <EmptyState
      icon={tone === 'error' ? TriangleAlert : Boxes}
      tone={tone}
      title={title}
      description={description}
      className={cn('h-full w-full border-border bg-[rgb(var(--bg-elev-rgb)/0.6)]', className)}
    />
  );
}

function SceneSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4"
    >
      <Skeleton className="h-full w-full" rounded="lg" />
      <span className="mono absolute text-[11px] uppercase tracking-[0.18em] text-muted">
        {label}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------- CanvasFrame */
export interface CanvasFrameProps {
  /** The scene. Rendered inside the Canvas, so it may use r3f hooks. */
  children: ReactNode;
  /** Describes the scene for screen readers and for the fallback panel. */
  label: string;
  /** Sizing comes from the caller; the frame always fills what it is given. */
  className?: string;
  camera?: CanvasProps['camera'];
  /** Shown when WebGL is unavailable or the scene throws. */
  fallback?: ReactNode;
  /** DOM drawn over the canvas — legends, captions, axis keys. */
  overlay?: ReactNode;
  /** True while the caller's data is still in flight: keeps the skeleton up. */
  loading?: boolean;
  /** Caption inside the skeleton. */
  loadingLabel?: string;
  /**
   * True for scenes the user can click through (constellation, lattice): the
   * frame then exposes its children to assistive tech instead of announcing
   * itself as a single image.
   */
  interactive?: boolean;
}

export default function CanvasFrame({
  children,
  label,
  className,
  camera,
  fallback,
  overlay,
  loading = false,
  loadingLabel = 'Initialising scene',
  interactive = false,
}: CanvasFrameProps) {
  const reducedMotion = useReducedMotion();
  const [supported] = useState<boolean>(() => isWebGLAvailable());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleCreated = useCallback<NonNullable<CanvasProps['onCreated']>>((state) => {
    const canvas = state.gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    const onRestored = () => setFailed(false);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    cleanupRef.current = () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
    setReady(true);
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleError = useCallback(() => setFailed(true), []);

  const shell = (content: ReactNode) => (
    <div
      className={cn('relative isolate h-full w-full overflow-hidden', className)}
      role={interactive ? 'group' : 'img'}
      aria-label={label}
    >
      {content}
    </div>
  );

  if (!supported) {
    return shell(
      fallback ?? (
        <SceneFallback
          title="3D view unavailable"
          description={`This browser or GPU is not offering WebGL, so the scene cannot be drawn. Scene: ${label}.`}
        />
      ),
    );
  }

  if (failed) {
    return shell(
      fallback ?? (
        <SceneFallback
          tone="error"
          title="3D view stopped"
          description={`The scene lost its graphics context. Reload the page to bring it back — the underlying data is unaffected. Scene: ${label}.`}
        />
      ),
    );
  }

  return shell(
    <>
      <div className="grid-ghost pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />

      <SceneErrorBoundary
        onError={handleError}
        fallback={
          fallback ?? (
            <SceneFallback
              tone="error"
              title="3D view stopped"
              description={`The scene could not be drawn. The data behind it is unaffected. Scene: ${label}.`}
            />
          )
        }
      >
        <Canvas
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={camera}
          frameloop={reducedMotion ? 'demand' : 'always'}
          onCreated={handleCreated}
          style={{ position: 'absolute', inset: 0 }}
        >
          <ReducedMotionContext.Provider value={reducedMotion}>
            <Suspense fallback={null}>{children}</Suspense>
          </ReducedMotionContext.Provider>
        </Canvas>
      </SceneErrorBoundary>

      {(!ready || loading) && <SceneSkeleton label={loadingLabel} />}

      {overlay}
    </>,
  );
}
