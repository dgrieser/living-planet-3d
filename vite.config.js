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
    // Three.js is lazy-loaded with the first simulation and is ~600 kB minified; the Living Earth chunk
    // (three's WebGPU renderer, 3d-tiles-renderer, astronomy-engine) is ~950 kB and loads only with it.
    chunkSizeWarningLimit: 1000,
  },
});
