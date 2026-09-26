import { useQuery } from '@tanstack/react-query';

import VerificationCore from '@/components/three/VerificationCore';
import type { VerdictMix } from '@/components/three/VerificationCore';
import { getDashboard } from '@/lib/api';

/**
 * The landing hero's 3D layer, isolated in its own module so the page can
 * `React.lazy` it and keep the three.js chunk out of the initial bundle.
 *
 * VerificationCore owns its own CanvasFrame (WebGL detection, dpr cap, skeleton,
 * reduced-motion), so sizing is all this wrapper has to supply — plus the shard
 * mix, which is the deployment's real verdict split rather than a decorative one.
 */
export default function HeroScene() {
  const { data } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: getDashboard,
    staleTime: 60_000,
  });

  const verified = data ? data.grounded + data.uncertain + data.ungrounded : 0;
  const mix: VerdictMix | undefined =
    data && verified > 0
      ? {
          grounded: data.grounded / verified,
          uncertain: data.uncertain / verified,
          ungrounded: data.ungrounded / verified,
        }
      : undefined;

  // The hero draws its own verdict key above the scrim, where it is legible;
  // an empty overlay suppresses the one the core would otherwise place under it.
  return <VerificationCore className="h-full w-full" mix={mix} overlay={<></>} />;
}
