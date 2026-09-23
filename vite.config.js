import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves the site from /Orbit/, so built asset paths need that prefix.
  base: command === 'build' ? '/Orbit/' : '/',
  server: { port: 5173 },
}));
