import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages has no routes: it serves 404.html for any address it does not
// have. A copy of the app there lets public pages (/Orbit/u/name, see
// src/route.js) open from a link, and the app reads the address itself.
const pagesFallback = () => {
  let outDir = 'dist';
  return {
    name: 'orbit-pages-fallback',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    closeBundle() {
      const index = path.join(outDir, 'index.html');
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, '404.html'));
    },
  };
};

export default defineConfig(({ command }) => ({
  plugins: [react(), pagesFallback()],
  // GitHub Pages serves the site from /Orbit/, so built asset paths need that prefix.
  base: command === 'build' ? '/Orbit/' : '/',
  server: { port: 5173 },
}));
