/**
 * VerificationCore — the landing hero (FRONTEND_BRIEF.md, "3D scenes" 1).
 *
 * A wireframe icosahedron "core" turns slowly while ~120 instanced clause
 * shards ride eccentric elliptical orbits whose periapsis lies *inside* the
 * core. Every pass through the core re-tints the shard grounded / uncertain /
 * ungrounded in the proportion given by `mix`, so the hero is a literal picture
 * of the product: nothing leaves the core untested.
 *
 * One draw call for every shard, no allocation per frame, and a single frozen
 * still under `prefers-reduced-motion`.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';

import CanvasFrame, {
  SceneFallback,
  useSceneMotion,
  useSceneRefresh,
} from '@/components/three/CanvasFrame';
import {
  clamp01,
  createCoreGeometry,
  createCoreWireframe,
  createInstanceColorAttribute,
  createInstancedBasicMaterial,
  createLineMaterial,
  createShardGeometry,
  disposeAll,
  fract,
  FROZEN_TIME,
  mixInto,
  tokenColor,
  verdictColor,
  VERDICTS,
  writeInstanceColor,
} from '@/components/three/primitives';
import { cn } from '@/lib/format';
import type { Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ props */
export interface VerdictMix {
  grounded: number;
  uncertain: number;
  ungrounded: number;
}

export interface VerificationCoreProps {
  className?: string;
  /**
   * Share of shards leaving the core with each verdict. Fractions are
   * normalised, so live `DashboardStats` counts can be passed straight in.
   * Defaults to the brief's 0.72 / 0.18 / 0.10.
   */
  mix?: VerdictMix;
  /** Shard count. The brief caps the hero at ~120. */
  shardCount?: number;
  /** Extra DOM over the canvas. Replaces the default verdict key. */
  overlay?: ReactNode;
}

const DEFAULT_MIX: VerdictMix = { grounded: 0.72, uncertain: 0.18, ungrounded: 0.1 };
const DEFAULT_SHARDS = 120;
const CORE_RADIUS = 1.9;

/* ------------------------------------------------------------ orbit field */
/** Deterministic PRNG so the frozen still and every reload agree. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of (shard, orbit number) → [0, 1). Allocation-free. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface OrbitField {
  count: number;
  /** Semi-major axis and eccentricity of each orbit. */
  semiMajor: Float32Array;
  semiMinor: Float32Array;
  eccentricity: Float32Array;
  /** Orbit orientation, pre-resolved to sin/cos pairs. */
  cosInclination: Float32Array;
  sinInclination: Float32Array;
  cosYaw: Float32Array;
  sinYaw: Float32Array;
  /** Orbits per second and starting offset. */
  rate: Float32Array;
  phase: Float32Array;
  scale: Float32Array;
}

function buildOrbitField(count: number): OrbitField {
  const random = mulberry32(0x1f2e3d);
  const field: OrbitField = {
    count,
    semiMajor: new Float32Array(count),
    semiMinor: new Float32Array(count),
    eccentricity: new Float32Array(count),
    cosInclination: new Float32Array(count),
    sinInclination: new Float32Array(count),
    cosYaw: new Float32Array(count),
    sinYaw: new Float32Array(count),
    rate: new Float32Array(count),
    phase: new Float32Array(count),
    scale: new Float32Array(count),
  };

  for (let i = 0; i < count; i += 1) {
    // Bounded by apoapsis so the field always frames; with e >= 0.72 the
    // periapsis then lands inside the core, so every shard is verified on
    // every pass.
    const apoapsis = 5.6 + random() * 3.4;
    const eccentricity = 0.72 + random() * 0.2;
    const semiMajor = apoapsis / (1 + eccentricity);

    field.eccentricity[i] = eccentricity;
    field.semiMajor[i] = semiMajor;
    field.semiMinor[i] = semiMajor * Math.sqrt(1 - eccentricity * eccentricity);

    const inclination = (random() - 0.5) * 1.5;
    field.cosInclination[i] = Math.cos(inclination);
    field.sinInclination[i] = Math.sin(inclination);

    const yaw = random() * Math.PI * 2;
    field.cosYaw[i] = Math.cos(yaw);
    field.sinYaw[i] = Math.sin(yaw);

    // Hypnotic, never busy: one full orbit takes 34–60 seconds.
    field.rate[i] = 1 / (34 + random() * 26);
    field.phase[i] = random();
    field.scale[i] = 0.3 + random() * 0.16;
  }

  return field;
}

/** Normalised cumulative thresholds for the verdict mix. */
function mixThresholds(mix: VerdictMix): [number, number] {
  const grounded = Math.max(0, mix.grounded);
  const uncertain = Math.max(0, mix.uncertain);
  const ungrounded = Math.max(0, mix.ungrounded);
  const total = grounded + uncertain + ungrounded;
  if (total <= 0) return [1, 1];
  return [grounded / total, (grounded + uncertain) / total];
}

/* ------------------------------------------------------------------ scene */
interface SceneProps {
  mix: VerdictMix;
  shardCount: number;
}

function Scene({ mix, shardCount }: SceneProps) {
  const reducedMotion = useSceneMotion();
  useSceneRefresh();

  const shardsRef = useRef<THREE.InstancedMesh>(null);

  const field = useMemo(() => buildOrbitField(shardCount), [shardCount]);
  // Depend on the numbers, not the object: callers rebuild the literal each render.
  const thresholds = useMemo(() => mixThresholds(mix), [mix]);

  const shardGeometry = useMemo(() => createShardGeometry(), []);
  const shardMaterial = useMemo(
    () => createInstancedBasicMaterial({ opacity: 0.92, side: THREE.DoubleSide }),
    [],
  );
  const colorAttribute = useMemo(() => createInstanceColorAttribute(shardCount), [shardCount]);

  const coreWireframe = useMemo(() => createCoreWireframe(CORE_RADIUS, 1), []);
  const coreGeometry = useMemo(() => createCoreGeometry(CORE_RADIUS * 0.98, 1), []);
  const coreLineMaterial = useMemo(() => createLineMaterial(tokenColor('accent'), 0.55), []);
  const coreShellMaterial = useMemo(() => {
    const material = createInstancedBasicMaterial({ opacity: 0.07, depthWrite: false });
    material.color.copy(tokenColor('accent'));
    return material;
  }, []);

  // Scratch objects: allocated once, mutated in place every frame.
  const scratch = useMemo(
    () => ({ dummy: new THREE.Object3D(), color: new THREE.Color() }),
    [],
  );

  useEffect(
    () => () =>
      disposeAll(
        shardGeometry,
        shardMaterial,
        coreWireframe,
        coreGeometry,
        coreLineMaterial,
        coreShellMaterial,
      ),
    [
      shardGeometry,
      shardMaterial,
      coreWireframe,
      coreGeometry,
      coreLineMaterial,
      coreShellMaterial,
    ],
  );

  useEffect(() => {
    shardsRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, [shardCount]);

  const coreRef = useRef<THREE.Group>(null);

  // Keep the whole orbit field inside the frame down to a 400px viewport.
  const viewportWidth = useThree((state) => state.viewport.width);
  const fit = Math.max(0.52, Math.min(1, viewportWidth / 19));

  useFrame((state) => {
    const mesh = shardsRef.current;
    if (!mesh) return;

    const time = reducedMotion ? FROZEN_TIME : state.clock.elapsedTime;
    const { dummy, color } = scratch;
    const neutral = tokenColor('muted');
    const [groundedMax, uncertainMax] = thresholds;

    if (coreRef.current) {
      coreRef.current.rotation.y = time * 0.09;
      coreRef.current.rotation.x = Math.sin(time * 0.05) * 0.24;
    }

    for (let i = 0; i < field.count; i += 1) {
      const turns = time * field.rate[i] + field.phase[i];
      const orbit = Math.floor(turns);
      const anomaly = fract(turns) * Math.PI * 2;

      const cosE = Math.cos(anomaly);
      const sinE = Math.sin(anomaly);
      const semiMajor = field.semiMajor[i];
      const eccentricity = field.eccentricity[i];

      // Ellipse with the core at its focus.
      const ex = semiMajor * (cosE - eccentricity);
      const ez = field.semiMinor[i] * sinE;
      const distance = semiMajor * (1 - eccentricity * cosE);

      // Tilt the orbital plane, then swing it round the vertical.
      const ty = -ez * field.sinInclination[i];
      const tz = ez * field.cosInclination[i];
      const x = ex * field.cosYaw[i] + tz * field.sinYaw[i];
      const z = -ex * field.sinYaw[i] + tz * field.cosYaw[i];

      // Inside the core it flashes; on the way out it carries its verdict,
      // which bleeds back to neutral as it coasts to apoapsis.
      const inside = clamp01(1 - distance / CORE_RADIUS);
      const outbound = anomaly < Math.PI ? 1 - (anomaly / Math.PI) ** 3 : 0;

      const roll = hash2(i, orbit);
      const verdict: Verdict =
        roll < groundedMax ? 'grounded' : roll < uncertainMax ? 'uncertain' : 'ungrounded';

      mixInto(color, neutral, verdictColor(verdict), outbound);
      writeInstanceColor(colorAttribute, i, color, 0.62 + outbound * 0.5 + inside * 1.5);

      dummy.position.set(x, ty, z);
      dummy.rotation.set(field.sinInclination[i], -anomaly, anomaly * 0.35);
      dummy.scale.setScalar(field.scale[i] * (0.86 + inside * 0.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  return (
    <group scale={fit}>
      <group ref={coreRef}>
        <lineSegments>
          <primitive object={coreWireframe} attach="geometry" />
          <primitive object={coreLineMaterial} attach="material" />
        </lineSegments>
        <mesh>
          <primitive object={coreGeometry} attach="geometry" />
          <primitive object={coreShellMaterial} attach="material" />
        </mesh>
      </group>

      <instancedMesh
        ref={shardsRef}
        args={[undefined, undefined, shardCount]}
        frustumCulled={false}
      >
        <primitive object={shardGeometry} attach="geometry" />
        <primitive object={shardMaterial} attach="material" />
        <primitive object={colorAttribute} attach="instanceColor" />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ key */
function VerdictKey() {
  return (
    <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1">
      {VERDICTS.map((verdict) => (
        <li key={verdict} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: `var(--${verdict})` }}
          />
          <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">{verdict}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- component */
export default function VerificationCore({
  className,
  mix = DEFAULT_MIX,
  shardCount = DEFAULT_SHARDS,
  overlay,
}: VerificationCoreProps) {
  const count = Math.max(0, Math.min(Math.round(shardCount), 240));

  if (count <= 0) {
    return (
      <div className={cn('relative h-full min-h-[240px] w-full', className)}>
        <SceneFallback
          title="No shards to verify"
          description="The core renders one shard per clause under test. Raise shardCount above zero to show the field."
        />
      </div>
    );
  }

  return (
    <CanvasFrame
      className={cn('min-h-[240px]', className)}
      label="Verification core: clause shards orbiting through an entailment check"
      camera={{ position: [0, 1.4, 13.5], fov: 38 }}
      loadingLabel="Spinning up the core"
      overlay={overlay ?? <VerdictKey />}
    >
      <Scene mix={mix} shardCount={count} />
    </CanvasFrame>
  );
}
