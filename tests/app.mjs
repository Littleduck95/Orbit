// Loads src/PersonalCRM.jsx for tests without touching it.
//
// The app is one file whose helpers are private to its module. This compiles
// the real source with Vite's own transformer, appends an export of every
// top-level name, and imports the result. The compiled copy is written under
// node_modules/.cache (ignored by git) so that its imports of react and
// papaparse resolve from this project.
//
// Every test process runs in one fixed timezone so date logic is repeatable.
// It is set here, before anything creates a Date.
process.env.TZ = 'America/Chicago';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithOxc } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ORBIT_SRC points the tests at another copy, to check they catch a planted bug.
const SRC = process.env.ORBIT_SRC || path.join(root, 'src', 'PersonalCRM.jsx');
const OUT_DIR = path.join(root, 'node_modules', '.cache', 'orbit-tests');

// Top-level declarations start in column 0 in this file; nested ones never do.
const topLevelNames = (src) => [...new Set(
  [...src.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
)];

export async function loadApp() {
  const src = fs.readFileSync(SRC, 'utf8');
  const names = topLevelNames(src);
  const { code: compiled } = await transformWithOxc(`${src}\nexport { ${names.join(', ')} };\n`, 'PersonalCRM.jsx', {
    jsx: { runtime: 'automatic' },
  });
  // The compiled copy lives elsewhere, so the app's own files it imports
  // ('./accountApi.js') are pointed back at src.
  const srcDir = pathToFileURL(path.join(root, 'src')).href;
  const code = compiled.replace(/from (['"])\.\/([^'"]+)\1/g, (m, q, f) => `from ${q}${srcDir}/${f}${q}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `app-${process.pid}.mjs`);
  fs.writeFileSync(out, code);
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

export const ROOT = root;
