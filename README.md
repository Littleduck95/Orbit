# Orbit

A personal CRM for keeping up with the people you actually want to keep up with.
Track who you care about, how often you mean to reach out, when you last did,
and the events and dates that matter to them.

The whole app is one component: [`src/PersonalCRM.jsx`](src/PersonalCRM.jsx).
Everything else in this repo is the shell needed to run it in a browser.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | ESLint over the project |

## Layout

```
index.html            page shell, mounts #root
src/main.jsx          entry point — installs the storage shim, renders the app
src/storage.js        window.storage shim backed by localStorage
src/PersonalCRM.jsx   the app
vite.config.js        build config
eslint.config.js      lint config
```

## What the app stores

People, events, the chosen theme, and your name live under four keys
(`crm-people-v1`, `crm-events-v1`, `crm-theme-v1`, `crm-owner-v1`). The app
reads and writes them through an async `window.storage` object.

`src/storage.js` provides that object, backed by `localStorage` and namespaced
under an `orbit:` prefix. Writes are allowed to fail loudly — the app already
catches a rejected write and tells you the change did not save, which is the
honest outcome when the browser refuses to persist (private mode, exhausted
quota, blocked site data).

There is a **Back up** button in the app that exports everything as JSON, and a
**Restore** button that reads it back. Use them; `localStorage` is per-browser
and per-device.

## Carried over from the app's original runtime

`src/PersonalCRM.jsx` was written against a host runtime that provided some
things a plain browser does not, so one seam remains:

**Place search on the Map tab.** Geocoding calls `api.anthropic.com` directly
with no API key, which worked because the original host injected credentials.
Here the request fails and the app falls back to its `offline` state: place
search reports it cannot reach the service, and the rest of the Map tab keeps
working. Wiring this up means routing the call through a small backend that
holds a key, or swapping in a geocoding service.

Nothing else in the app is affected.

## Known lint warnings

`npm run lint` reports two pre-existing warnings in `src/PersonalCRM.jsx`, both
harmless and left alone so the file stays as it was written:

- `totalCount` is defined but never used — dead helper.
- A `useMemo` is flagged for not listing `ofCircle` in its deps. `ofCircle`
  only closes over `people`, which *is* in the dep array, so the memo is
  correct as written.
