import { defineConfig } from 'vite';

// Relative base so the static build works at any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repository-name>/) without hardcoding a
// repository name. Use '/' instead only when serving from a domain root.
export default defineConfig({
  base: './',
  // Force a single copy of three.js across the app and xrblocks.
  resolve: { dedupe: ['three'] },
});
