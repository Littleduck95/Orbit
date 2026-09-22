# Orbit

A personal CRM for keeping up with the people you actually want to keep up with.
Track who you care about, how often you mean to reach out, when you last did,
and the events and dates that matter to them. Reminders cover the other half:
the things that come round again whether or not anyone tells you. Lists hold
everything else worth keeping track of: shows, books, the collection.

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

## Reminders

The Reminders tab holds anything that comes round again: the furnace filter,
the card balance, the conference talks posted every autumn. Two things decide
how a reminder behaves.

**How the repeat is counted.** Intervals are calendar units, not days, so
monthly on the 15th stays on the 15th instead of drifting, and a yearly
reminder keeps its date through leap years. A repeat pinned to the 31st comes
back to the 31st after a short February rather than sticking at the 28th.

**What the gap is measured from.** Every repeating reminder is anchored one of
two ways, because the two jobs genuinely differ:

| Anchor | Counts from | Fits |
| --- | --- | --- |
| The calendar | its slot in the month or year | a bill due on the 15th, estimated taxes, open enrollment |
| The day I do it | the day you tick it off | a filter that lasts three months from the change, an oil change |

A calendar-anchored reminder keeps its place whether you act early or late,
and skips over anything already missed so catching up on three late months
does not leave you three months behind. A completion-anchored one restarts its
clock when you finish the job.

Each reminder also carries a **notice period** — how far ahead it starts
nudging you — because a passport or an enrollment window is no use to you on
the morning it closes.

Reminders that are due, soon, or late appear in **Coming up** on the People
tab, alongside birthdays and events, so there is one list of what is
approaching. They can be attached to people, and show on that person's card.

The tab ships with a set of starter reminders at the intervals each job is
usually given. They are suggestions, not defaults: picking one opens the form
filled in, and nothing is saved until you say so.

## Lists

The Lists tab holds lists you make yourself: shows to watch, books to read,
records, games, places, a collection you are building, gift ideas. Each list
has a kind, which only supplies starting words. Everything it fills in can be
changed on the list:

- **Stages.** A list can track progress in up to three stages, named in your
  own words: *Want to read / Reading / Read*, *Wanted / On the way / In the
  collection*. Leave the middle one empty when there is no in-between (a film
  is rarely half-watched), or switch stages off for a plain ranked list.
  Stages are stored under fixed keys, so renaming them, changing the kind or
  turning tracking off and back on never loses anyone's progress.
- **The line under each title.** Author, where to watch it, the set it
  belongs to. Leave it empty to skip it.

Inside a list, type a title and press Enter to add it. Tap the circle beside an
entry to move it to its next stage, or tap the entry for its rating, link,
notes, and who recommended it. Recommendations show on that person's card. A
list remembers how you last sorted it: your own order (with a Reorder mode that
works from the keyboard), A to Z (which files *The Bear* under B, the way a
shelf would), newest, highest rated, or by progress.

**Sharing** never includes who recommended what. Notes, and the list's
description, only go when you tick *Include my notes*. A list can be shared two
ways:

| How | What they get |
| --- | --- |
| Copy as text, Share…, or Email it | Plain text anyone can read, grouped by stage with ratings, or numbered in your order |
| Copy Orbit link | Their own copy, starting fresh with no progress or ratings |

An Orbit link carries the whole list inside it (`#share=…`), so there is no
server to hold it and nothing expires. Opening it offers the list rather than
adding it, and the link is removed from the address bar so a reload does not
offer it twice. The link only opens where Orbit is hosted. Someone running
their own copy can paste the link, or just the code at the end of it, under
**Add a shared list**. Everything arriving this way is checked before it is
kept: only `http` and `https` links survive, and text is trimmed to sensible
lengths.

## What the app stores

People, events, reminders, lists, the chosen theme, and your name live under
six keys (`crm-people-v1`, `crm-events-v1`, `crm-reminders-v1`,
`crm-collections-v1`, `crm-theme-v1`, `crm-owner-v1`). Lists are called
collections in the code, because "list" already means the people list there.
The app reads and writes them through an async `window.storage` object.

`src/storage.js` provides that object, backed by `localStorage` and namespaced
under an `orbit:` prefix. Writes are allowed to fail loudly — the app already
catches a rejected write and tells you the change did not save, which is the
honest outcome when the browser refuses to persist (private mode, exhausted
quota, blocked site data).

There is a **Back up** button in the app that exports everything as JSON, and a
**Restore** button that reads it back. Use them; `localStorage` is per-browser
and per-device. Older backups that predate reminders or lists still restore —
the app treats a missing `reminders` or `collections` key as an empty list. A
backup with lists but nobody in it restores too. Back up and Restore sit under
the People tab and appear once anything at all is saved.

Import and export cover reminders and lists too. A reminder CSV is recognised
by its `Next due` column, which is what tells it apart from an events sheet. A
lists CSV has one row per entry and is recognised by having both a `Title` and
a `List` column but no `Name` column. The `Name` rule means a people sheet with
a job-title column is still read as people. Importing it adds entries to a list
of the same name if you already have one, reading their stages in that list's
own words. Otherwise stages are read from the usual words (*Reading*,
*Finished*, *yes*, *Not started*). A sheet with no `List kind` column gets its
kind from the list's name, so a list called *Books* reads *Reading* as a stage.
A plain list comes back plain. A new list made from a sheet has its kind's
stage words, not any custom ones, so the JSON backup is the lossless copy. A
list holds at most 2,000 entries, and the import screen says how many would not
fit before anything is saved.

Every CSV export guards against formula injection. A cell starting `=`, `+`,
`-` or `@` would run as a formula in Excel or Sheets, and list titles can come
from anyone who shares a list. Such cells get a leading `'`, and import takes it
off again. Plain signed numbers are left alone, so a longitude of `-94.58`
stays a number.

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
