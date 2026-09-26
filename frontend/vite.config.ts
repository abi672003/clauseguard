import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND = 'http://localhost:8000';

/** Vendor chunks: the 3D stack and the charting stack are both heavy and only
 *  needed on a subset of routes, so they are split out of the main bundle. */
const THREE_PKGS = ['three', '@react-three/fiber', '@react-three/drei'];
const CHART_PKGS = ['recharts', 'victory-vendor', 'd3-'];

function inNodeModules(id: string, pkgs: string[]): boolean {
  const marker = 'node_modules/';
  const at = id.lastIndexOf(marker);
  if (at === -1) return false;
  const rest = id.slice(at + marker.length);
  return pkgs.some((pkg) => rest === pkg || rest.startsWith(pkg));
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1/ws': { target: BACKEND, ws: true, changeOrigin: true },
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (inNodeModules(id, THREE_PKGS)) return 'three';
          if (inNodeModules(id, CHART_PKGS)) return 'charts';
          return undefined;
        },
      },
    },
  },
});
