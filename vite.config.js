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
    // Three.js is lazy-loaded with the first simulation and is ~570 kB minified.
    chunkSizeWarningLimit: 700,
  },
});
