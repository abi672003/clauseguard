/**
 * ClauseLattice — the contract-detail scene (FRONTEND_BRIEF.md, "3D scenes" 4).
 *
 * Every clause in the contract is one block in a stacked lattice: height is
 * clause length, colour is the verdict of the obligation drawn from it (inert
 * grey where nothing was extracted), and the selected block burns with an
 * additive halo so the 3D view and the text pane agree on what is selected.
 */
import { Html, OrbitControls } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';

import CanvasFrame, { useSceneMotion, useSceneRefresh } from '@/components/three/CanvasFrame';
import {
  createBlockGeometry,
  createInstanceColorAttribute,
  createInstancedBasicMaterial,
  createInstancedStandardMaterial,
  createLineMaterial,
  createSegmentsGeometry,
  disposeAll,
  fract,
  FROZEN_TIME,
  pulse,
  tokenColor,
  verdictColor,
  writeInstanceColor,
} from '@/components/three/primitives';
import EmptyState from '@/components/ui/EmptyState';
import { cn, formatNumber, humanize } from '@/lib/format';
import type { Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ props */
export interface LatticeClause {
  id: string;
  /** Clause length in characters — drives block height. */
  length: number;
  /** Verdict of the obligation drawn from this clause, if any. */
  verdict: Verdict | null;
  /** True when the prefilter promoted the clause for extraction. */
  isCandidate: boolean;
}

export interface ClauseLatticeProps {
  clauses: LatticeClause[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  className?: string;
  loading?: boolean;
  emptyAction?: ReactNode;
}

const FOOTPRINT = 0.78;
const GAP = 0.06;
const COLUMN_LIMIT = 6.4;
const COLUMN_PITCH = 1.15;

/* ----------------------------------------------------------------- layout */
interface Layout {
  count: number;
  /** Block base positions, xyz triples. */
  positions: Float32Array;
  heights: Float32Array;
  /** Half-extent of the lattice footprint, for the floor outline. */
  halfX: number;
  halfZ: number;
  /** Tallest column, for framing. */
  peak: number;
}

function buildLayout(clauses: readonly LatticeClause[]): Layout {
  const count = clauses.length;
  const positions = new Float32Array(count * 3);
  const heights = new Float32Array(count);

  // A non-finite length would poison every matrix downstream.
  const lengthOf = (clause: LatticeClause) =>
    Number.isFinite(clause.length) ? Math.max(clause.length, 0) : 0;

  let longest = 1;
  for (const clause of clauses) longest = Math.max(longest, lengthOf(clause));

  // First pass: heights, and how many columns the stack needs.
  const columnOf = new Int32Array(count);
  const baseOf = new Float32Array(count);
  let column = 0;
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const height = 0.16 + 1.15 * Math.sqrt(lengthOf(clauses[i]) / longest);
    heights[i] = height;
    if (cursor > 0 && cursor + height > COLUMN_LIMIT) {
      column += 1;
      cursor = 0;
    }
    columnOf[i] = column;
    baseOf[i] = cursor;
    cursor += height + GAP;
  }

  const columns = column + 1;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(columns)));
  const rows = Math.ceil(columns / perRow);
  const offsetX = ((perRow - 1) * COLUMN_PITCH) / 2;
  const offsetZ = ((rows - 1) * COLUMN_PITCH) / 2;

  let peak = 0;
  for (let i = 0; i < count; i += 1) {
    const col = columnOf[i];
    positions[i * 3] = (col % perRow) * COLUMN_PITCH - offsetX;
    positions[i * 3 + 1] = baseOf[i];
    positions[i * 3 + 2] = Math.floor(col / perRow) * COLUMN_PITCH - offsetZ;
    peak = Math.max(peak, baseOf[i] + heights[i]);
  }

  return {
    count,
    positions,
    heights,
    halfX: offsetX + FOOTPRINT,
    halfZ: offsetZ + FOOTPRINT,
    peak,
  };
}

function floorOutline(halfX: number, halfZ: number): number[] {
  const y = -0.02;
  return [
    -halfX, y, -halfZ, halfX, y, -halfZ,
    halfX, y, -halfZ, halfX, y, halfZ,
    halfX, y, halfZ, -halfX, y, halfZ,
    -halfX, y, halfZ, -halfX, y, -halfZ,
  ];
}

function blockColor(clause: LatticeClause): THREE.Color {
  if (clause.verdict) return verdictColor(clause.verdict);
  return clause.isCandidate ? tokenColor('accent') : tokenColor('muted');
}

/* ------------------------------------------------------------------ scene */
interface SceneProps {
  clauses: LatticeClause[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Scene({ clauses, selectedId, onSelect }: SceneProps) {
  const reducedMotion = useSceneMotion();
  useSceneRefresh();

  const blocksRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const spinRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => buildLayout(clauses), [clauses]);
  const { count } = layout;
  const selectedIndex = useMemo(
    () => (selectedId ? clauses.findIndex((clause) => clause.id === selectedId) : -1),
    [clauses, selectedId],
  );

  const blockGeometry = useMemo(() => createBlockGeometry(), []);
  const blockMaterial = useMemo(
    () => createInstancedStandardMaterial({ roughness: 0.46, metalness: 0.16, flatShading: true }),
    [],
  );
  const blockColors = useMemo(() => createInstanceColorAttribute(Math.max(count, 1)), [count]);

  const haloGeometry = useMemo(() => createBlockGeometry(), []);
  const haloMaterial = useMemo(() => createInstancedBasicMaterial({ additive: true }), []);
  const haloColors = useMemo(() => createInstanceColorAttribute(1), []);

  const floorGeometry = useMemo(
    () => createSegmentsGeometry(floorOutline(layout.halfX, layout.halfZ)),
    [layout.halfX, layout.halfZ],
  );
  const floorMaterial = useMemo(() => createLineMaterial(tokenColor('muted'), 0.3), []);

  const scratch = useMemo(() => ({ dummy: new THREE.Object3D() }), []);

  useEffect(
    () => () =>
      disposeAll(
        blockGeometry,
        blockMaterial,
        haloGeometry,
        haloMaterial,
        floorMaterial,
      ),
    [blockGeometry, blockMaterial, haloGeometry, haloMaterial, floorMaterial],
  );

  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);

  // Blocks are static: transforms are written once per data change.
  useEffect(() => {
    const mesh = blocksRef.current;
    if (!mesh) return;
    const { dummy } = scratch;

    for (let i = 0; i < count; i += 1) {
      dummy.position.set(
        layout.positions[i * 3],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2],
      );
      dummy.scale.set(FOOTPRINT, layout.heights[i], FOOTPRINT);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, count, scratch]);

  // Colour only changes with the data, the selection or the hover.
  useEffect(() => {
    for (let i = 0; i < count; i += 1) {
      const clause = clauses[i];
      const dim = clause.isCandidate ? 1 : 0.5;
      const emphasis = i === selectedIndex ? 2.1 : i === hovered ? 1.45 : 1;
      writeInstanceColor(blockColors, i, blockColor(clause), 0.62 * dim * emphasis);
    }
    blockColors.needsUpdate = true;
  }, [clauses, count, blockColors, selectedIndex, hovered]);

  // The halo tracks whichever block is selected.
  useEffect(() => {
    const mesh = haloRef.current;
    if (!mesh) return;
    const { dummy } = scratch;

    if (selectedIndex < 0) {
      dummy.position.set(0, 0, 0);
      dummy.scale.setScalar(0);
    } else {
      dummy.position.set(
        layout.positions[selectedIndex * 3],
        layout.positions[selectedIndex * 3 + 1] - 0.03,
        layout.positions[selectedIndex * 3 + 2],
      );
      dummy.scale.set(FOOTPRINT * 1.22, layout.heights[selectedIndex] + 0.06, FOOTPRINT * 1.22);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(0, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [selectedIndex, layout, scratch]);

  useFrame((state, delta) => {
    const time = reducedMotion ? FROZEN_TIME : state.clock.elapsedTime;

    // Idle spin, well under the brief's 0.15 rad/s, accumulated so it can be
    // paused the moment the pointer is over a block without snapping.
    if (spinRef.current && !reducedMotion && hovered === null) {
      spinRef.current.rotation.y += delta * 0.06;
    }

    if (selectedIndex >= 0) {
      const glow = reducedMotion ? 0.55 : pulse(fract(time * 0.42));
      writeInstanceColor(
        haloColors,
        0,
        blockColor(clauses[selectedIndex]),
        0.22 + glow * 0.34,
      );
      haloColors.needsUpdate = true;
    }
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
      const clause = clauses[id];
      if (clause) onSelect(clause.id);
    },
    [clauses, onSelect],
  );

  useEffect(() => {
    if (hovered === null) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [hovered]);

  const active = hovered !== null ? clauses[hovered] : undefined;

  return (
    <>
      <ambientLight intensity={0.68} />
      <directionalLight position={[5, 9, 6]} intensity={1.05} />
      <directionalLight position={[-7, 4, -5]} intensity={0.35} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        rotateSpeed={0.5}
        zoomSpeed={0.6}
        minDistance={6}
        maxDistance={28}
        maxPolarAngle={Math.PI * 0.52}
        target={[0, Math.min(layout.peak, COLUMN_LIMIT) * 0.42, 0]}
      />

      <group ref={spinRef}>
        <lineSegments>
          <primitive object={floorGeometry} attach="geometry" />
          <primitive object={floorMaterial} attach="material" />
        </lineSegments>

        <instancedMesh
          ref={blocksRef}
          args={[undefined, undefined, Math.max(count, 1)]}
          frustumCulled={false}
          onPointerMove={handleMove}
          onPointerOut={handleOut}
          onClick={handleClick}
        >
          <primitive object={blockGeometry} attach="geometry" />
          <primitive object={blockMaterial} attach="material" />
          <primitive object={blockColors} attach="instanceColor" />
        </instancedMesh>

        <instancedMesh ref={haloRef} args={[undefined, undefined, 1]} frustumCulled={false}>
          <primitive object={haloGeometry} attach="geometry" />
          <primitive object={haloMaterial} attach="material" />
          <primitive object={haloColors} attach="instanceColor" />
        </instancedMesh>

        {active && hovered !== null && (
          <Html
            position={[
              layout.positions[hovered * 3],
              layout.positions[hovered * 3 + 1] + layout.heights[hovered] + 0.35,
              layout.positions[hovered * 3 + 2],
            ]}
            center
            pointerEvents="none"
            zIndexRange={[40, 0]}
          >
            <div className="glass whitespace-nowrap px-2.5 py-1.5 text-left">
              <p className="mono text-[10px] text-text">Clause {hovered + 1}</p>
              <p className="mono text-[10px] text-muted">
                {active.verdict ? humanize(active.verdict) : active.isCandidate ? 'Candidate' : 'Not extracted'}
                {' · '}
                {formatNumber(active.length)} chars
              </p>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

/* ------------------------------------------------------------- component */
export default function ClauseLattice({
  clauses,
  selectedId = null,
  onSelect,
  className,
  loading = false,
  emptyAction,
}: ClauseLatticeProps) {
  if (!loading && clauses.length === 0) {
    return (
      <div className={cn('relative h-full min-h-[240px] w-full', className)}>
        <EmptyState
          title="No clauses segmented yet"
          description="The lattice renders one block per clause once this contract has been segmented. Run the analysis to build it."
          action={emptyAction}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <CanvasFrame
      className={cn('min-h-[240px]', className)}
      label="Clause lattice: one block per clause, height by length, colour by verdict"
      camera={{ position: [7.5, 6.5, 10.5], fov: 38 }}
      loading={loading}
      loadingLabel="Building the lattice"
      interactive
    >
      <Scene clauses={clauses} selectedId={selectedId} onSelect={onSelect} />
    </CanvasFrame>
  );
}
