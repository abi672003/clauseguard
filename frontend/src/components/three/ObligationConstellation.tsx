/**
 * ObligationConstellation — the dashboard scatter (FRONTEND_BRIEF.md,
 * "3D scenes" 2). One instanced sphere per obligation:
 *
 *   x = entailment probability (0 → 1 mapped across the frame)
 *   y = days until due, log-scaled and signed so overdue work sinks
 *   z = severity rank (low → critical)
 *
 * Colour is the verdict. Hovering raycasts the instance and raises an HTML
 * tooltip; clicking hands the id back so the dashboard can route to it.
 */
import { Html, OrbitControls } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';

import CanvasFrame, { useSceneMotion, useSceneRefresh } from '@/components/three/CanvasFrame';
import {
  clamp,
  createInstanceColorAttribute,
  createInstancedBasicMaterial,
  createLineMaterial,
  createNodeGeometry,
  createSegmentsGeometry,
  damp,
  disposeAll,
  tokenColor,
  verdictColor,
  writeInstanceColor,
} from '@/components/three/primitives';
import EmptyState from '@/components/ui/EmptyState';
import { cn, formatPct, humanize, severityRank, truncate, verdictColorVar } from '@/lib/format';
import type { Severity, Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ props */
export interface ConstellationPoint {
  id: string;
  title: string;
  /** Entailment probability, 0–1. */
  entailment: number;
  /** Negative when overdue, null when the obligation has no deadline. */
  daysUntilDue: number | null;
  severity: Severity;
  verdict: Verdict;
}

export interface ObligationConstellationProps {
  points: ConstellationPoint[];
  onSelect: (id: string) => void;
  className?: string;
  /** Keeps the skeleton up while the dashboard query is in flight. */
  loading?: boolean;
  /** Rendered in the empty state — e.g. a "Load the CUAD sample" button. */
  emptyAction?: ReactNode;
}

/* ----------------------------------------------------------------- layout */
const X_HALF = 6;
const Y_LIMIT = 5.2;
const Z_HALF = 2.6;
const ORIGIN_X = -X_HALF - 0.7;
const ORIGIN_Y = -Y_LIMIT - 0.7;
const ORIGIN_Z = -Z_HALF - 0.9;
const POINT_RADIUS = 0.17;

/** Entailment 0–1 → the full width of the frame. */
function entailmentAxis(entailment: number): number {
  if (!Number.isFinite(entailment)) return -X_HALF;
  return clamp(entailment, 0, 1) * (X_HALF * 2) - X_HALF;
}

/** Signed log scale: one decade of lead time per ~1.85 units, overdue below 0. */
function dueDateAxis(days: number | null): number {
  if (days === null || !Number.isFinite(days)) return 0;
  const sign = days < 0 ? -1 : 1;
  return clamp(sign * Math.log10(1 + Math.abs(days)) * 1.85, -Y_LIMIT, Y_LIMIT);
}

function severityAxis(severity: Severity): number {
  return (severityRank(severity) - 1.5) * (Z_HALF / 1.5);
}

interface Layout {
  count: number;
  positions: Float32Array;
  scales: Float32Array;
}

function buildLayout(points: readonly ConstellationPoint[]): Layout {
  const count = points.length;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const point = points[i];
    positions[i * 3] = entailmentAxis(point.entailment);
    positions[i * 3 + 1] = dueDateAxis(point.daysUntilDue);
    positions[i * 3 + 2] = severityAxis(point.severity);
    // Severity also reads as mass, so critical work is legible head-on.
    scales[i] = 1 + severityRank(point.severity) * 0.16;
  }

  return { count, positions, scales };
}

/** The corner frame plus its ticks, as one line-segment buffer. */
function buildAxisSegments(): number[] {
  const segments: number[] = [
    // the three axes
    ORIGIN_X, ORIGIN_Y, ORIGIN_Z, X_HALF + 0.7, ORIGIN_Y, ORIGIN_Z,
    ORIGIN_X, ORIGIN_Y, ORIGIN_Z, ORIGIN_X, Y_LIMIT + 0.7, ORIGIN_Z,
    ORIGIN_X, ORIGIN_Y, ORIGIN_Z, ORIGIN_X, ORIGIN_Y, Z_HALF + 0.9,
  ];

  for (const entailment of [0, 0.25, 0.5, 0.75, 1]) {
    const x = entailmentAxis(entailment);
    segments.push(x, ORIGIN_Y, ORIGIN_Z, x, ORIGIN_Y, ORIGIN_Z - 0.28);
  }

  for (const days of [-365, -30, 0, 30, 365]) {
    const y = dueDateAxis(days);
    segments.push(ORIGIN_X, y, ORIGIN_Z, ORIGIN_X - 0.28, y, ORIGIN_Z);
  }

  for (const severity of ['low', 'medium', 'high', 'critical'] as const) {
    const z = severityAxis(severity);
    segments.push(ORIGIN_X, ORIGIN_Y, z, ORIGIN_X - 0.28, ORIGIN_Y, z);
  }

  return segments;
}

function AxisLabel({ position, children }: { position: [number, number, number]; children: ReactNode }) {
  return (
    <Html position={position} center pointerEvents="none" zIndexRange={[20, 0]}>
      <span className="mono whitespace-nowrap text-[9px] uppercase tracking-[0.18em] text-muted">
        {children}
      </span>
    </Html>
  );
}

function describeDue(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return 'no due date';
  if (days === 0) return 'due today';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `due in ${days}d`;
}

/* ------------------------------------------------------------------ scene */
interface SceneProps {
  points: readonly ConstellationPoint[];
  onSelect: (id: string) => void;
}

function Scene({ points, onSelect }: SceneProps) {
  const reducedMotion = useSceneMotion();
  useSceneRefresh();

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => buildLayout(points), [points]);
  const { count } = layout;

  const pointGeometry = useMemo(() => createNodeGeometry(POINT_RADIUS, 16, 12), []);
  const pointMaterial = useMemo(() => createInstancedBasicMaterial(), []);
  const colorAttribute = useMemo(() => createInstanceColorAttribute(count), [count]);
  const axisGeometry = useMemo(() => createSegmentsGeometry(buildAxisSegments()), []);
  const axisMaterial = useMemo(() => createLineMaterial(tokenColor('muted'), 0.38), []);

  const scratch = useMemo(() => ({ dummy: new THREE.Object3D() }), []);
  const boostRef = useRef<Float32Array>(new Float32Array(0));

  useEffect(() => {
    boostRef.current = new Float32Array(count);
  }, [count]);

  useEffect(
    () => () =>
      disposeAll(pointGeometry, pointMaterial, axisGeometry, axisMaterial),
    [pointGeometry, pointMaterial, axisGeometry, axisMaterial],
  );

  // Positions never move, so the transforms are written once per data change.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { dummy } = scratch;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < count; i += 1) {
      dummy.position.set(
        layout.positions[i * 3],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2],
      );
      dummy.scale.setScalar(layout.scales[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(colorAttribute, i, verdictColor(points[i].verdict), 0.92);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, count, points, colorAttribute, scratch]);

  // Only the hover highlight animates, and only while it is settling.
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const boost = boostRef.current;
    if (!mesh || boost.length !== count) return;

    let dirty = false;
    for (let i = 0; i < count; i += 1) {
      const target = i === hovered ? 1 : 0;
      const difference = target - boost[i];
      if (Math.abs(difference) < 0.001) {
        if (boost[i] !== target) {
          boost[i] = target;
          dirty = true;
        }
        continue;
      }
      boost[i] = reducedMotion ? target : damp(boost[i], target, 12, delta);
      dirty = true;
    }
    if (!dirty) return;

    const { dummy } = scratch;
    for (let i = 0; i < count; i += 1) {
      const lift = boost[i];
      dummy.position.set(
        layout.positions[i * 3],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2],
      );
      dummy.scale.setScalar(layout.scales[i] * (1 + lift * 0.9));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(colorAttribute, i, verdictColor(points[i].verdict), 0.92 + lift * 0.85);
    }
    mesh.instanceMatrix.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  const handleMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const id = event.instanceId;
    setHovered((current) => (id === undefined || current === id ? current : id));
  }, []);

  const handleOut = useCallback(() => setHovered(null), []);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const id = event.instanceId;
      if (id === undefined) return;
      const point = points[id];
      if (point) onSelect(point.id);
    },
    [onSelect, points],
  );

  useEffect(() => {
    if (hovered === null) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [hovered]);

  const active = hovered !== null ? points[hovered] : undefined;

  return (
    <>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.075}
        enablePan={false}
        rotateSpeed={0.55}
        zoomSpeed={0.6}
        minDistance={9}
        maxDistance={30}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.28}
      />

      <lineSegments>
        <primitive object={axisGeometry} attach="geometry" />
        <primitive object={axisMaterial} attach="material" />
      </lineSegments>

      <AxisLabel position={[0, ORIGIN_Y - 0.75, ORIGIN_Z]}>entailment →</AxisLabel>
      <AxisLabel position={[-X_HALF, ORIGIN_Y - 0.75, ORIGIN_Z]}>0.0</AxisLabel>
      <AxisLabel position={[X_HALF, ORIGIN_Y - 0.75, ORIGIN_Z]}>1.0</AxisLabel>
      <AxisLabel position={[ORIGIN_X - 1, Y_LIMIT + 0.5, ORIGIN_Z]}>due later</AxisLabel>
      <AxisLabel position={[ORIGIN_X - 1, 0, ORIGIN_Z]}>today</AxisLabel>
      <AxisLabel position={[ORIGIN_X - 1, -Y_LIMIT - 0.4, ORIGIN_Z]}>overdue</AxisLabel>
      <AxisLabel position={[ORIGIN_X - 0.4, ORIGIN_Y - 0.55, Z_HALF + 1.1]}>severity →</AxisLabel>

      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, Math.max(count, 1)]}
        frustumCulled={false}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <primitive object={pointGeometry} attach="geometry" />
        <primitive object={pointMaterial} attach="material" />
        <primitive object={colorAttribute} attach="instanceColor" />
      </instancedMesh>

      {active && hovered !== null && (
        <Html
          position={[
            layout.positions[hovered * 3],
            layout.positions[hovered * 3 + 1] + 0.42,
            layout.positions[hovered * 3 + 2],
          ]}
          center
          pointerEvents="none"
          zIndexRange={[40, 0]}
        >
          <div className="glass w-52 max-w-[60vw] px-3 py-2 text-left">
            <p className="text-[11px] font-semibold leading-snug text-text">
              {truncate(active.title, 72)}
            </p>
            <p className="mono mt-1 text-[10px] text-muted">
              <span style={{ color: verdictColorVar(active.verdict) }}>{active.verdict}</span>
              {' · '}
              {formatPct(active.entailment, 1)} entailed
            </p>
            <p className="mono text-[10px] text-muted">
              {humanize(active.severity)} · {describeDue(active.daysUntilDue)}
            </p>
          </div>
        </Html>
      )}
    </>
  );
}

/* ------------------------------------------------------------- component */
export default function ObligationConstellation({
  points,
  onSelect,
  className,
  loading = false,
  emptyAction,
}: ObligationConstellationProps) {
  if (!loading && points.length === 0) {
    return (
      <div className={cn('relative h-full min-h-[260px] w-full', className)}>
        <EmptyState
          title="No verified obligations yet"
          description="The constellation plots one point per obligation once a contract has been analysed. Load the CUAD sample or upload a contract to populate it."
          action={emptyAction}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <CanvasFrame
      className={cn('min-h-[260px]', className)}
      label="Obligation constellation: entailment against time to deadline and severity"
      camera={{ position: [10.5, 6.5, 14], fov: 42 }}
      loading={loading}
      loadingLabel="Plotting obligations"
      interactive
    >
      <Scene points={points} onSelect={onSelect} />
    </CanvasFrame>
  );
}
