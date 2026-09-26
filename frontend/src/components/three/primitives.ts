/**
 * Shared building blocks for the ClauseGuard 3D layer.
 *
 * Three rules this module exists to enforce:
 *  1. Colour comes from the CSS design tokens in `src/index.css`, read at
 *     runtime — never from a literal baked into a scene.
 *  2. Geometries and materials are built by factories the scenes call once
 *     inside `useMemo`, and dispose on unmount via `disposeAll`.
 *  3. Nothing here allocates while a frame is being drawn: the per-frame
 *     helpers write into buffers the caller already owns.
 */
import * as THREE from 'three';

import type { Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ time */
/**
 * The instant every scene freezes at when `prefers-reduced-motion: reduce`
 * is set. Non-zero so phase-offset elements still read as a composed still
 * rather than collapsing onto their start positions.
 */
export const FROZEN_TIME = 11.5;

/* ---------------------------------------------------------------- easing */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fractional part, always in [0, 1) even for negative input. */
export function fract(value: number): number {
  return value - Math.floor(value);
}

function bezierAxis(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

/**
 * The product's motion curve — `cubic-bezier(0.22, 1, 0.36, 1)`, the same
 * `--ease` the CSS uses — solved by bisection so 3D motion and DOM motion
 * share one feel. Allocation-free.
 */
export function easeInstrument(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  const x = clamp01(t);
  let low = 0;
  let high = 1;
  let mid = x;
  for (let i = 0; i < 12; i += 1) {
    mid = (low + high) * 0.5;
    if (bezierAxis(mid, 0.22, 0.36) < x) low = mid;
    else high = mid;
  }
  return bezierAxis(mid, 1, 1);
}

/**
 * Frame-rate independent exponential approach. `lambda` is roughly "how many
 * e-folds per second"; 6–10 feels like instrument-grade damping.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(target, current, Math.exp(-lambda * Math.min(dt, 0.1)));
}

/** 0 → 1 → 0 over the unit interval, eased at both ends. */
export function pulse(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/* ---------------------------------------------------------------- tokens */
export type TokenName =
  | 'bg'
  | 'bg-elev'
  | 'text'
  | 'muted'
  | 'accent'
  | 'grounded'
  | 'uncertain'
  | 'ungrounded';

const tokenCache = new Map<TokenName, THREE.Color>();

/** Neutral stand-in used only if the stylesheet has not applied yet. */
function missingToken(): THREE.Color {
  return new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);
}

function readToken(name: TokenName): THREE.Color {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return missingToken();
  }
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (!raw) return missingToken();
  try {
    return new THREE.Color().setStyle(raw, THREE.SRGBColorSpace);
  } catch {
    return missingToken();
  }
}

/**
 * The design token `--{name}` as a THREE.Color in the renderer's working
 * colour space. Cached — treat the result as read-only and `copy()` it
 * before mutating.
 */
export function tokenColor(name: TokenName): THREE.Color {
  const cached = tokenCache.get(name);
  if (cached) return cached;
  const color = readToken(name);
  tokenCache.set(name, color);
  return color;
}

/** Drops the cache so the next read picks the tokens up again. */
export function refreshTokenColors(): void {
  tokenCache.clear();
}

/** verdict → token colour. The single source of verdict hue in 3D. */
export function verdictColor(verdict: Verdict | null | undefined): THREE.Color {
  switch (verdict) {
    case 'grounded':
      return tokenColor('grounded');
    case 'ungrounded':
      return tokenColor('ungrounded');
    case 'uncertain':
      return tokenColor('uncertain');
    default:
      // No verdict yet — unverified material reads as inert instrument grey.
      return tokenColor('muted');
  }
}

/** The full map, for legends and for scenes that index by verdict. */
export function verdictColorMap(): Record<Verdict, THREE.Color> {
  return {
    grounded: tokenColor('grounded'),
    uncertain: tokenColor('uncertain'),
    ungrounded: tokenColor('ungrounded'),
  };
}

export const VERDICTS: readonly Verdict[] = ['grounded', 'uncertain', 'ungrounded'];

/* ------------------------------------------------------------ geometries */
/** Faceted shell for the verification core. */
export function createCoreGeometry(radius = 1.9, detail = 1): THREE.IcosahedronGeometry {
  return new THREE.IcosahedronGeometry(radius, detail);
}

/** Edge-only twin of the core, for `<lineSegments>`. */
export function createCoreWireframe(radius = 1.9, detail = 1): THREE.WireframeGeometry {
  const solid = new THREE.IcosahedronGeometry(radius, detail);
  const wire = new THREE.WireframeGeometry(solid);
  solid.dispose();
  return wire;
}

function pushQuad(
  positions: number[],
  normals: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  halfWidth: number,
  halfHeight: number,
): void {
  const base = positions.length / 3;
  positions.push(
    x - halfWidth, y - halfHeight, z,
    x + halfWidth, y - halfHeight, z,
    x + halfWidth, y + halfHeight, z,
    x - halfWidth, y + halfHeight, z,
  );
  for (let i = 0; i < 4; i += 1) normals.push(0, 0, 1);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * A clause shard: a small plane with three "text" ticks ruled across it, all
 * merged into one geometry so 120 of them cost a single draw call.
 */
export function createShardGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // body
  pushQuad(positions, normals, indices, 0, 0, 0, 0.5, 0.3);

  // "text" ticks, nudged forward a hair so they never z-fight with the body
  const tickRows = [0.14, 0, -0.14];
  const tickHalfWidths = [0.34, 0.4, 0.22];
  for (let i = 0; i < tickRows.length; i += 1) {
    pushQuad(positions, normals, indices, 0, tickRows[i], 0.004, tickHalfWidths[i], 0.035);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Low-poly sphere — the constellation point and the pipeline node. */
export function createNodeGeometry(radius = 1, widthSegments = 16, heightSegments = 12): THREE.SphereGeometry {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
}

/**
 * Unit-length tube along +Y with its origin at the base, so scaling Y fills
 * it from the upstream node outwards.
 */
export function createTubeGeometry(radius = 0.035, radialSegments = 8): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, radialSegments, 1, true);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** Unit cube with its origin on the base face, so scaling Y grows upwards. */
export function createBlockGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** Axis guide lines built from an explicit segment list. */
export function createSegmentsGeometry(points: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(points), 3));
  return geometry;
}

/* ------------------------------------------------------------- materials */
export interface BasicMaterialOptions {
  opacity?: number;
  transparent?: boolean;
  additive?: boolean;
  depthWrite?: boolean;
  side?: THREE.Side;
}

/**
 * Unlit material for instanced meshes. Left white on purpose: the per-instance
 * colour attribute multiplies it, and that attribute carries the tokens.
 */
export function createInstancedBasicMaterial(options: BasicMaterialOptions = {}): THREE.MeshBasicMaterial {
  const { opacity = 1, transparent = opacity < 1, additive = false, depthWrite, side } = options;
  const material = new THREE.MeshBasicMaterial({
    transparent: transparent || additive,
    opacity,
    toneMapped: false,
  });
  if (additive) material.blending = THREE.AdditiveBlending;
  material.depthWrite = depthWrite ?? !(additive || transparent);
  if (side) material.side = side;
  return material;
}

export interface StandardMaterialOptions {
  roughness?: number;
  metalness?: number;
  opacity?: number;
  flatShading?: boolean;
}

/** Lit material for instanced meshes that need volume (the clause lattice). */
export function createInstancedStandardMaterial(
  options: StandardMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const { roughness = 0.42, metalness = 0.12, opacity = 1, flatShading = false } = options;
  return new THREE.MeshStandardMaterial({
    roughness,
    metalness,
    opacity,
    transparent: opacity < 1,
    flatShading,
    toneMapped: false,
  });
}

export function createLineMaterial(color: THREE.Color, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: color.clone(),
    transparent: opacity < 1,
    opacity,
    toneMapped: false,
  });
}

/* ------------------------------------------------- per-instance colouring */
/** Dynamic-usage colour attribute sized for `count` instances. */
export function createInstanceColorAttribute(count: number): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

/**
 * Writes one instance's colour, optionally scaled (for pulses and dimming).
 * Allocation-free — safe to call from `useFrame`. The caller flips
 * `attribute.needsUpdate` once per frame after the batch.
 */
export function writeInstanceColor(
  attribute: THREE.InstancedBufferAttribute,
  index: number,
  color: THREE.Color,
  scale = 1,
): void {
  const array = attribute.array as Float32Array;
  const offset = index * 3;
  array[offset] = color.r * scale;
  array[offset + 1] = color.g * scale;
  array[offset + 2] = color.b * scale;
}

/** Blends two token colours into `target` without allocating. */
export function mixInto(
  target: THREE.Color,
  from: THREE.Color,
  to: THREE.Color,
  t: number,
): THREE.Color {
  const k = clamp01(t);
  target.setRGB(
    from.r + (to.r - from.r) * k,
    from.g + (to.g - from.g) * k,
    from.b + (to.b - from.b) * k,
  );
  return target;
}

/* ------------------------------------------------------------- lifecycle */
export interface Disposable {
  dispose(): void;
}

/** Releases every GPU resource a scene created. Call from an unmount cleanup. */
export function disposeAll(...resources: ReadonlyArray<Disposable | null | undefined>): void {
  for (const resource of resources) {
    resource?.dispose();
  }
}
