import ObligationConstellation from '@/components/three/ObligationConstellation';
import type { ConstellationPoint } from '@/components/three/ObligationConstellation';

export interface ConstellationSceneProps {
  points: ConstellationPoint[];
  /** Fired on click of a point; the panel routes to the obligation. */
  onSelect: (obligationId: string) => void;
}

/**
 * The dashboard's 3D layer, isolated in its own module so the panel can
 * `React.lazy` it and keep the three.js chunk out of the initial bundle.
 * ObligationConstellation owns its own CanvasFrame, so sizing is all this
 * wrapper has to supply.
 */
export default function ConstellationScene({ points, onSelect }: ConstellationSceneProps) {
  return <ObligationConstellation className="h-full w-full" points={points} onSelect={onSelect} />;
}
