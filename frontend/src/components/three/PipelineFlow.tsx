/**
 * PipelineFlow — the live analysis scene (FRONTEND_BRIEF.md, "3D scenes" 3).
 *
 * Nine stage nodes on a gentle arc, joined by tubes. Completed tubes fill with
 * `--accent`, the active node pulses and emits a packet that travels to the
 * next node. Every visual state is derived from props alone, so the pipeline
 * WebSocket drives this scene simply by re-rendering it with a new
 * `activeStage` / `completed`.
 */
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import CanvasFrame, { useSceneMotion, useSceneRefresh } from '@/components/three/CanvasFrame';
import {
  clamp01,
  createInstanceColorAttribute,
  createInstancedBasicMaterial,
  createNodeGeometry,
  createTubeGeometry,
  damp,
  disposeAll,
  fract,
  FROZEN_TIME,
  pulse,
  tokenColor,
  writeInstanceColor,
} from '@/components/three/primitives';
import EmptyState from '@/components/ui/EmptyState';
import { cn, humanize } from '@/lib/format';

/* ------------------------------------------------------------------ props */
export interface PipelineFlowProps {
  /** Stage names in pipeline order — `PIPELINE_STAGES` from `@/lib/types`. */
  stages: string[];
  /** The stage currently running. `failed` marks the run as stalled. */
  activeStage: string;
  /** Stages already finished. */
  completed: string[];
  className?: string;
}

const SPAN = 12.6;
const ARC_HEIGHT = 1.15;
const FAILED = 'failed';

/* ---------------------------------------------------------------- geometry */
interface Track {
  nodeCount: number;
  segmentCount: number;
  /** Node centres, xyz triples. */
  nodes: Float32Array;
  /** Tube start points, xyz triples. */
  origins: Float32Array;
  /** Tube orientations as xyzw quaternions. */
  quaternions: Float32Array;
  /** Tube lengths. */
  lengths: Float32Array;
  /** Unit vectors along each tube, for the packet. */
  directions: Float32Array;
}

function buildTrack(stageCount: number): Track {
  const nodeCount = Math.max(stageCount, 0);
  const segmentCount = Math.max(nodeCount - 1, 0);
  const track: Track = {
    nodeCount,
    segmentCount,
    nodes: new Float32Array(nodeCount * 3),
    origins: new Float32Array(segmentCount * 3),
    quaternions: new Float32Array(segmentCount * 4),
    lengths: new Float32Array(segmentCount),
    directions: new Float32Array(segmentCount * 3),
  };

  for (let i = 0; i < nodeCount; i += 1) {
    const t = nodeCount === 1 ? 0.5 : i / (nodeCount - 1);
    track.nodes[i * 3] = (t - 0.5) * SPAN;
    track.nodes[i * 3 + 1] = Math.sin(t * Math.PI) * ARC_HEIGHT - ARC_HEIGHT * 0.5;
    track.nodes[i * 3 + 2] = 0;
  }

  // Build-time allocation only: these never escape into the render loop.
  const up = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  for (let i = 0; i < segmentCount; i += 1) {
    from.fromArray(track.nodes, i * 3);
    to.fromArray(track.nodes, (i + 1) * 3);
    direction.subVectors(to, from);
    const length = direction.length();
    direction.normalize();
    quaternion.setFromUnitVectors(up, direction);

    track.origins[i * 3] = from.x;
    track.origins[i * 3 + 1] = from.y;
    track.origins[i * 3 + 2] = from.z;
    track.directions[i * 3] = direction.x;
    track.directions[i * 3 + 1] = direction.y;
    track.directions[i * 3 + 2] = direction.z;
    track.lengths[i] = length;
    quaternion.toArray(track.quaternions, i * 4);
  }

  return track;
}

/* ------------------------------------------------------------------ scene */
interface SceneProps {
  stages: string[];
  activeStage: string;
  completed: string[];
}

function Scene({ stages, activeStage, completed }: SceneProps) {
  const reducedMotion = useSceneMotion();
  useSceneRefresh();

  const nodesRef = useRef<THREE.InstancedMesh>(null);
  const tubesRef = useRef<THREE.InstancedMesh>(null);
  const fillsRef = useRef<THREE.InstancedMesh>(null);
  const packetRef = useRef<THREE.InstancedMesh>(null);

  const track = useMemo(() => buildTrack(stages.length), [stages.length]);
  const { nodeCount, segmentCount } = track;

  const completedSet = useMemo(() => new Set(completed), [completed]);
  const activeIndex = stages.indexOf(activeStage);
  const failed = activeStage === FAILED;

  const nodeGeometry = useMemo(() => createNodeGeometry(0.3, 18, 14), []);
  const packetGeometry = useMemo(() => createNodeGeometry(0.15, 12, 10), []);
  const tubeGeometry = useMemo(() => createTubeGeometry(0.035, 8), []);
  const fillGeometry = useMemo(() => createTubeGeometry(0.052, 8), []);

  const nodeMaterial = useMemo(() => createInstancedBasicMaterial(), []);
  const tubeMaterial = useMemo(() => createInstancedBasicMaterial({ opacity: 0.35 }), []);
  const fillMaterial = useMemo(() => createInstancedBasicMaterial(), []);
  const packetMaterial = useMemo(() => createInstancedBasicMaterial({ additive: true }), []);

  const nodeColors = useMemo(() => createInstanceColorAttribute(Math.max(nodeCount, 1)), [nodeCount]);
  const tubeColors = useMemo(
    () => createInstanceColorAttribute(Math.max(segmentCount, 1)),
    [segmentCount],
  );
  const fillColors = useMemo(
    () => createInstanceColorAttribute(Math.max(segmentCount, 1)),
    [segmentCount],
  );
  const packetColors = useMemo(
    () => createInstanceColorAttribute(Math.max(segmentCount, 1)),
    [segmentCount],
  );

  const scratch = useMemo(
    () => ({ dummy: new THREE.Object3D(), quaternion: new THREE.Quaternion() }),
    [],
  );
  const progressRef = useRef<Float32Array>(new Float32Array(0));

  useEffect(() => {
    progressRef.current = new Float32Array(segmentCount);
  }, [segmentCount]);

  useEffect(
    () => () =>
      disposeAll(
        nodeGeometry,
        packetGeometry,
        tubeGeometry,
        fillGeometry,
        nodeMaterial,
        tubeMaterial,
        fillMaterial,
        packetMaterial,
      ),
    [
      nodeGeometry,
      packetGeometry,
      tubeGeometry,
      fillGeometry,
      nodeMaterial,
      tubeMaterial,
      fillMaterial,
      packetMaterial,
    ],
  );

  // The unlit base tubes never move: write them once per stage-count change.
  useEffect(() => {
    const mesh = tubesRef.current;
    if (!mesh) return;
    const { dummy, quaternion } = scratch;
    const border = tokenColor('muted');

    for (let i = 0; i < segmentCount; i += 1) {
      quaternion.fromArray(track.quaternions, i * 4);
      dummy.position.fromArray(track.origins, i * 3);
      dummy.quaternion.copy(quaternion);
      dummy.scale.set(1, track.lengths[i], 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(tubeColors, i, border, 0.7);
    }
    mesh.count = segmentCount;
    mesh.instanceMatrix.needsUpdate = true;
    tubeColors.needsUpdate = true;
  }, [track, segmentCount, tubeColors, scratch]);

  useFrame((state, delta) => {
    const nodes = nodesRef.current;
    const fills = fillsRef.current;
    const packets = packetRef.current;
    const progress = progressRef.current;
    if (!nodes || !fills || !packets || progress.length !== segmentCount) return;

    const time = reducedMotion ? FROZEN_TIME : state.clock.elapsedTime;
    const { dummy, quaternion } = scratch;
    const accent = tokenColor('accent');
    const idle = tokenColor('muted');
    const alarm = tokenColor('ungrounded');
    const beat = reducedMotion ? 0.65 : pulse(fract(time * 0.55));

    /* nodes --------------------------------------------------------------- */
    for (let i = 0; i < nodeCount; i += 1) {
      const done = completedSet.has(stages[i]);
      const isActive = i === activeIndex;
      const stalled = failed && i === Math.min(completedSet.size, nodeCount - 1);

      let scale = done ? 1 : 0.76;
      let brightness = done ? 1 : 0.5;
      let color = done ? accent : idle;

      if (isActive) {
        scale = 1.18 + beat * 0.22;
        brightness = 1.15 + beat * 0.85;
        color = accent;
      } else if (stalled) {
        scale = 1.1;
        brightness = 1.2;
        color = alarm;
      }

      dummy.position.fromArray(track.nodes, i * 3);
      dummy.quaternion.identity();
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      nodes.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(nodeColors, i, color, brightness);
    }
    nodes.count = nodeCount;
    nodes.instanceMatrix.needsUpdate = true;
    nodeColors.needsUpdate = true;

    /* completed tubes ------------------------------------------------------ */
    for (let i = 0; i < segmentCount; i += 1) {
      const target =
        completedSet.has(stages[i]) && (completedSet.has(stages[i + 1]) || activeIndex > i) ? 1 : 0;
      progress[i] = reducedMotion ? target : damp(progress[i], target, 5, delta);
      const filled = clamp01(progress[i]);

      quaternion.fromArray(track.quaternions, i * 4);
      dummy.position.fromArray(track.origins, i * 3);
      dummy.quaternion.copy(quaternion);
      dummy.scale.set(filled > 0.001 ? 1 : 0, track.lengths[i] * filled, filled > 0.001 ? 1 : 0);
      dummy.updateMatrix();
      fills.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(fillColors, i, accent, 0.9);
    }
    fills.count = segmentCount;
    fills.instanceMatrix.needsUpdate = true;
    fillColors.needsUpdate = true;

    /* the packet in flight ------------------------------------------------- */
    const carrying = !failed && activeIndex >= 0 && activeIndex < segmentCount;
    const travel = reducedMotion ? 0.5 : fract(time * 0.42);
    for (let i = 0; i < segmentCount; i += 1) {
      const live = carrying && i === activeIndex;
      if (!live) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.updateMatrix();
        packets.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const distance = track.lengths[i] * travel;
      dummy.position.set(
        track.origins[i * 3] + track.directions[i * 3] * distance,
        track.origins[i * 3 + 1] + track.directions[i * 3 + 1] * distance,
        track.origins[i * 3 + 2] + track.directions[i * 3 + 2] * distance,
      );
      dummy.quaternion.identity();
      dummy.scale.setScalar(0.7 + pulse(travel) * 0.6);
      dummy.updateMatrix();
      packets.setMatrixAt(i, dummy.matrix);
      writeInstanceColor(packetColors, i, accent, 1.5);
    }
    packets.count = segmentCount;
    packets.instanceMatrix.needsUpdate = true;
    packetColors.needsUpdate = true;
  });

  // Keep the whole arc inside the frame down to a 400px viewport.
  const viewportWidth = useThree((state) => state.viewport.width);
  const fit = Math.max(0.42, Math.min(1, viewportWidth / (SPAN + 2.4)));

  return (
    <group scale={fit}>
      <instancedMesh ref={tubesRef} args={[undefined, undefined, Math.max(segmentCount, 1)]} frustumCulled={false}>
        <primitive object={tubeGeometry} attach="geometry" />
        <primitive object={tubeMaterial} attach="material" />
        <primitive object={tubeColors} attach="instanceColor" />
      </instancedMesh>

      <instancedMesh ref={fillsRef} args={[undefined, undefined, Math.max(segmentCount, 1)]} frustumCulled={false}>
        <primitive object={fillGeometry} attach="geometry" />
        <primitive object={fillMaterial} attach="material" />
        <primitive object={fillColors} attach="instanceColor" />
      </instancedMesh>

      <instancedMesh ref={packetRef} args={[undefined, undefined, Math.max(segmentCount, 1)]} frustumCulled={false}>
        <primitive object={packetGeometry} attach="geometry" />
        <primitive object={packetMaterial} attach="material" />
        <primitive object={packetColors} attach="instanceColor" />
      </instancedMesh>

      <instancedMesh ref={nodesRef} args={[undefined, undefined, Math.max(nodeCount, 1)]} frustumCulled={false}>
        <primitive object={nodeGeometry} attach="geometry" />
        <primitive object={nodeMaterial} attach="material" />
        <primitive object={nodeColors} attach="instanceColor" />
      </instancedMesh>

      {stages.map((stage, index) => {
        const done = completedSet.has(stage);
        const isActive = index === activeIndex;
        return (
          <Html
            key={stage}
            position={[
              track.nodes[index * 3],
              track.nodes[index * 3 + 1] - (index % 2 === 0 ? 0.62 : 1.14),
              track.nodes[index * 3 + 2],
            ]}
            center
            pointerEvents="none"
            zIndexRange={[20, 0]}
          >
            <span
              className={cn(
                'mono whitespace-nowrap text-[9px] uppercase tracking-[0.14em]',
                isActive ? 'text-accent' : done ? 'text-text' : 'text-muted',
              )}
            >
              {stage}
            </span>
          </Html>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------- component */
export default function PipelineFlow({
  stages,
  activeStage,
  completed,
  className,
}: PipelineFlowProps) {
  const done = completed.filter((stage) => stages.includes(stage)).length;

  if (stages.length === 0) {
    return (
      <div className={cn('relative h-full min-h-[200px] w-full', className)}>
        <EmptyState
          title="No pipeline run"
          description="Start an analysis to watch the contract move through ingest, extraction, verification and the agent."
          className="h-full"
        />
      </div>
    );
  }

  return (
    <CanvasFrame
      className={cn('min-h-[200px]', className)}
      label={`Analysis pipeline: ${humanize(activeStage)}, ${done} of ${stages.length} stages complete`}
      camera={{ position: [0, 0.4, 11.5], fov: 36 }}
      loadingLabel="Connecting to the pipeline"
      overlay={
        <div className="pointer-events-none absolute left-3 top-3 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-text">{humanize(activeStage)}</span>
          <span className="mono text-[10px] text-muted">
            {done}/{stages.length} stages
          </span>
        </div>
      }
    >
      <Scene stages={stages} activeStage={activeStage} completed={completed} />
    </CanvasFrame>
  );
}
