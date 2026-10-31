import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // Three.js is lazy-loaded with the first simulation and is ~600 kB minified. The Living Earth loads
    // three's WebGPU build (~800 kB) and 3d-tiles-renderer only with its own route – as separate library
    // chunks, so the simulation's own code stays small and cacheable on its own.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/build/three.webgpu') || id.includes('node_modules/three/build/three.tsl')) return 'three-webgpu';
          if (id.includes('node_modules/3d-tiles-renderer')) return 'tiles-renderer';
          return undefined;
        },
      },
    },
  },
});
