# Orbit

A personal CRM for keeping up with the people you actually want to keep up with.
Track who you care about, how often you mean to reach out, when you last did,
and the events and dates that matter to them. Reminders cover the other half:
the things that come round again whether or not anyone tells you. Lists hold
everything else worth keeping track of: shows, books, the collection. Trips
are the places you have been, on a map, with photos.

The app itself is one component: [`src/PersonalCRM.jsx`](src/PersonalCRM.jsx).
Everything else in this repo is the shell needed to run it in a browser, the
account behind it, and a few modules it loads.

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
| `npm test` | Logic, storage and account tests (Node's built-in runner, no extra installs) |
| `npm run test:browser` | Drives the real app in Chromium; needs Playwright installed |
| `npm run test:account` | Drives sign-in in Chromium against a stand-in for Supabase; needs Playwright |
| `npm run test:db` | Runs `supabase/schema.sql` on a throwaway PostgreSQL and checks its security rules; needs PostgreSQL installed |
| `npm run test:notify` | Tests the notify function under Deno (fetched by npx), including a real encrypted push |

The tests are characterization tests: they pin down what the app does today,
with the clock, timezone and locale fixed so dates are repeatable. Checks whose
names start `CURRENT:` record behaviour an audit flagged as questionable; if
that behaviour is changed on purpose, the check changes in the same commit.
`tests/app.mjs` compiles the real `src/PersonalCRM.jsx` with Vite's own
transformer to reach its private helpers, without touching the source.
Playwright is not a dependency of this project; the browser runner finds an
installed copy, or says plainly that there is none.

## Layout

```
index.html            page shell, mounts #root
src/main.jsx          entry point — signs in (or installs local storage), renders the app
src/storage.js        window.storage backed by localStorage, when there are no accounts
src/supabase.js       the Supabase client, from the settings in .env
src/Account.jsx       sign-in screen; opens the account before the app is drawn
src/cloudStorage.js   window.storage backed by the signed-in account
supabase/schema.sql   the table and its access rules, run once in Supabase
.env                  which Supabase project to use (public values)
src/Recovery.jsx      shown instead of a blank page if drawing ever fails
src/PersonalCRM.jsx   the app
src/photoStore.js     trip photos in IndexedDB, and preparing uploads
src/TripMap.jsx       the Leaflet maps, loaded only when a map is shown
src/mapConfig.js      map tiles and place search: one entry each
src/geo.js            country and US state outlines: which one a stop is in, and shading
tests/                characterization tests (logic, storage, account, browser)
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

## Sharing people

Anyone in Orbit can be sent to another Orbit user as a **copy**: the recipient
gets their own card to keep and change, and nothing stays linked to the
sender's. **Share** on a person's card opens a field picker:

| Starts | Fields |
| --- | --- |
| Always sent | Name |
| Ticked | Role and company, Also known as |
| Unticked | Email, phone, address, birthday or age, other dates, partner, kids, socials, hobbies |
| Unticked, marked private | Notes, "Knows" tags, family names, check-in cadence |
| Never offered | Closeness, relation, check-in history, last contact, VIP, paused, circle |

The share goes as a link (compressed into the part after `#`, which is never
sent to the server), a `.orbit` file (the same content as readable JSON), or a
QR code of the link for passing a card across a table. A link too long to
arrive in one piece is only offered as a file.

Opening a link, or pasting one or choosing a file under **Import**, shows
exactly what arrived and who says they sent it, before anything is saved. If
the person looks like someone already here (same name, a name either side
also goes by, the same phone however it is written, or the same email), the
choice is **Merge**, **Add as new**, or **Skip**. A merge lists every field
that would change: blanks and additions start ticked, and anything that
differs starts on keeping yours. New people go into the circle you pick. Each
card can carry a small "From Brock · date" note, which can be taken off.

Both ends go through one whitelist of fields, so a share can never carry more
than the picker offered, and a hand-edited one cannot slip anything else in.
Lists shared with the older links still open as before.

## Recap

Recap shows a year: catch-ups, people added, events, reminders kept, lists
crossed off, and **the year in trips**: how many, days away, countries, US
states and places, the top-rated trip, a map of them all, the countries seen
for the first time, and what is still planned for the rest of the year. The
four latest years are buttons, and any before that are in an *Earlier* menu.
When the year turns over while Orbit is open (or on coming back to it),
Recap moves on to the new year by itself, unless an older one is being
looked at on purpose.

## Trips

The Trips tab keeps the places you have been, and the ones you mean to go: a
title, one or more stops, the dates, a rating out of five stars in half steps,
a short highlight, longer notes, who went with you, tags, and up to 30 photos.
It shows them on a map with the trips as cards underneath, or as the cards
alone, and filters by kind, year, rating, companion and tag. "Add a shared
trip" sits beside "Add a trip". Tapping a card under the map finds that trip
on the map.

**Been, planned, someday.** A trip is one you took (it needs a start date), a
planned one (dates optional), or a someday wish (no dates, no rating). Trips
to come are hollow pins, a solid ring for planned and a dashed one for
someday, and the cards fall into *Coming up* (soonest first), *Recent trips*
(newest first) and *Someday*. Once a planned trip's dates have gone by, it
asks "Did you go?", and one tap makes it a trip you took. An entry on a
Places list has *Put it on the trip map*, which opens a new someday trip (or
a been trip, if the entry is ticked off) with its name filled in and its
place already being searched for. Only a trip still to come stores a
`status`, so every trip saved before plans existed reads as it did.

**Stats** across the top count, from the trips you took, the countries, US
states and places you have been, the days away this year (each day once,
however many trips it was part of, and only up to today), and the place you
have been back to most. Stops within 15 km of each other count as one place.
*Hide stats* puts them away, and that is remembered; Recap has the same
numbers year by year either way.

**Where a stop is** (its country, and its state in the US) is worked out on
the device from Natural Earth and US Census outlines ([`src/geo.js`](src/geo.js)),
not asked of a web service, so every stop counts however it was added and
nothing about where you have been leaves the device. The outlines are about
280 KB and load only when Trips or Recap first needs them. A stop just off
the coast is given to the nearest country within about 30 km. *Shade
countries I have been to*, beside the map's key, colours in those countries,
and the US states, for the trips shown.

**Ratings**, on trips and list entries alike, go from half a star to five in
half steps. A whole number means what it always did, so ratings saved, backed
up or shared before halves existed read the same.

**The map** is [Leaflet](https://leafletjs.com) with Stadia Maps' Alidade
Smooth tiles, light or dark to match the theme. There is a pin for every stop,
coloured by rating with the rating written on it (a half star shares its whole
star's colour), and nearby pins gather into numbered circles. Tapping a pin
opens the trip's title, dates, stars, highlight and first photo. The map frames
every trip shown, and with none it shows the world and an offer to add one.

**Adding a stop** works three ways: search by name, tap the map to drop a
pin and name it, or type the coordinates. Search uses
[Stadia Maps' autocomplete](https://docs.stadiamaps.com/geocoding-search-autocomplete/),
recognised by the site's domain like the tiles. Each request uses Stadia
credits, so typing is given a pause before anything is sent, requests keep at
least 300 ms apart, and answers are remembered for the visit. The event form's Find button uses the same search.

**Photos** are redrawn on a canvas before they are kept: at most 1600 pixels
on the long edge, as JPEG at 0.8 quality, with a separate thumbnail of about
300 pixels for grids, cards and popups. Redrawing leaves out everything the
camera wrote into the file, including where the photo was taken, which is on
purpose. A file the browser cannot open (HEIC, outside Safari) gets a message
saying to use JPEG or PNG. The first photo is the cover; any can be made the
cover instead.

Deleting a trip asks first, then deletes its photos with it. Photos added to
a form that is then cancelled are deleted again. Photos taken off a trip are
only deleted once the trip is saved. On load, photos no trip refers to and
older than a day are tidied away, but only when the saved trips read cleanly.

**People.** A person's card lists the trips they went on, under *Trips
together*, each linking to the trip.

**Pinned events.** The old Map tab listed events that had a place pinned. The
first time Trips opens with such events, it offers to turn them into trips.
The events stay on the timeline, and each trip remembers which event it came
from, so none is offered twice. A start screen saved as the Map opens on Trips.

**Sending a copy** works the way it does for a person (see [Sharing
people](#sharing-people)): a link, a QR code of it, or an `.orbit` file, with
a *From* name, and the same preview before anything is added. The share
carries the places, dates, rating, highlight and tags. Who went with you never
goes, and notes only go when ticked. *Include photos* (off by default) adds
the photos, which only fit in the file, so the link and QR code are put away
while it is ticked. It arrives by opening the link, or under Import or *Add a
shared trip*, and is always added as a new trip, never over one already here.
*Copy as text* is there for someone without Orbit.

## The backup file

**Backup file** (in the ⋮ menu, beside Back up under People, and in Settings)
saves everything in one `.zip`: `orbit.json` with every record, and each
photo beside it as a JPEG. It gives the size before making the file. Restoring
it merges rather than replaces. Records are matched by id, anything missing is
added, trips and lists are updated when the file's copy is newer, and restoring
the same file twice adds nothing. It is in the ⋮ menu even when nothing is
saved, which is the case after clearing site data. A pasted-style JSON backup
saved as a file restores too, without photos.

Trip records are saved like everything else, so with an account they follow
the person to every device. **Photos do not**: they stay in the browser that
added them, and the backup file is the only other copy. The Trips tab says
so, once, in words that fit whether or not an account is in use, and suggests
a backup file now and then. The backup screen says when the last one was made,
and Settings says roughly how much of this browser's storage Orbit is using.

## Accounts

Orbit asks people to log in or create an account, and keeps their data in
their own account on [Supabase](https://supabase.com),
so it is the same on every device they sign in on. The project is set in
`.env`. Both values there are public by design: the publishable key can only
do what the row-level security in `supabase/schema.sql` allows, which is each
signed-in person reading and writing their own rows. Leave either value empty
and Orbit runs as it did before, saving only in the browser with no sign-in.
The browser tests do exactly that. `npm run test:account` covers signing in
itself, against a stand-in that answers like Supabase, so it never touches the
real project.

Each of the app's keys (below) is one row in the `orbit_data` table, holding
the same text the app always stored. The whole account is read once when it
opens, and every change is written straight to it; a change only counts as
saved once the account has it, so the app's "did not save" message still
means what it says. On one device, saves of the same kind go one at a time
and in order, so a slow one can never land after, and undo, a newer one; while
one is on its way, further changes wait and go together as the newest. If two
devices change the same kind of thing (say, both edit people) the later save
wins.

- **The first sign-in** moves everything this browser had saved into an empty
  account, then removes the browser's copy, so the next person to sign in on
  the same computer does not inherit it. If the account already has data and
  so does the browser, the two are never mixed: Orbit asks which to keep, and
  offers the browser's copy as a download first. Keeping the account's moves
  the browser's older data aside (under `orbit:parked:`) rather than deleting it.
- **Offline**, Orbit opens from a copy of the account kept in this browser
  (under `orbit:@<user id>:`) and says so. Changes do not save until the
  connection is back. With no copy, it says it cannot reach the account rather
  than opening empty. Signing out removes the copy.
- **A shared-list link** opened while signed out is held through sign-in and
  offered afterwards.
- **Creating an account** asks for a name (what friends see), a username
  (how friends find you: lowercase letters, numbers, dots and underscores),
  an email, a password of at least 8 characters, and a birthday. Orbit is for
  people 13 and older, which the database enforces as well as the form. A
  confirmation email finishes the sign-up.
- **Logging in** is by email and password, with a link by email or Google as
  alternatives, and **Forgot password?** sends a reset link. An account made
  with Google or an email link, or before usernames existed, is asked once
  for a username, name and birthday.
- **Settings** (⋮ menu) shows the account and changes the name, username,
  birthday, email (confirmed by a link) and password. It also deletes the
  account, which removes the sign-in, the profile and every saved row.
  Email and birthday are only ever shown to their owner.
- **Sign out** is in the ⋮ menu, under your username.

### Friends and profiles

**Friends** (⋮ menu, with a dot while a request waits) finds people by the
start of their username or any part of their name, and sends a request they
accept or decline. Each person has a friend code: a QR code of a link
(`#add=username`) that opens their profile ready to add, even after signing
in. A friend can be saved into People through the same preview and merge as a
share, and anyone can be blocked, which ends any friendship and hides each
from the other.

**Settings → Profile** chooses what others see. Name and username always
show; everything else (pronouns, about, where you live, birthday, phone, an
email for friends, website, socials) is set to Everyone, Friends or Only me,
with a preview of how a stranger and a friend see it. Phone and the friends
email start as Only me. The sign-in email is never shown. People can also
turn off being found in search, leaving only their code.

The database decides what each viewer receives: profiles are only read
through functions that apply those settings, and friendships and blocks are
only changed through functions that check who is asking.

### Preferences and notifications

**Settings → Preferences** holds the theme, which tab Orbit opens on, and
notifications:

- **Push**, per device: **Turn on** asks the browser's permission and signs
  this device up; **Send a test** checks it end to end. iPhones and iPads only
  allow push once Orbit is on the Home Screen (Share → Add to Home Screen),
  and the screen says so. A manifest and icons make Orbit installable, and a
  service worker (`public/sw.js`) shows pushes while Orbit is closed. It
  caches nothing.
- **Email digest**, daily or on Mondays for the week ahead, only when there
  is something in it.
- **What**: birthdays (on the day, or up to two weeks before), reminders (when
  they come into view and when due), check-ins falling overdue, events (the
  day before and the day of), and friend requests.
- **When**: an hour of the day in the person's own time zone, and quiet hours
  that hold friend request pushes until they end.

The sending is done by `supabase/functions/notify`, a Supabase Edge Function
called hourly by a scheduled job (`supabase/notifications-cron.sql`). For each
person whose hour it is, it reads their saved Orbit, works out what is due,
sends one push to each of their devices and or one email, and logs each item
so it never goes twice. Devices the push service reports gone are dropped.
`npm run test:notify` runs its tests under Deno, including a real encrypted
push to a stand-in push service, decrypted as a device would.

### Setting up the Supabase project

Done once, in the [Supabase dashboard](https://supabase.com/dashboard):

1. **Create the tables.** SQL Editor → New query → paste all of
   `supabase/schema.sql` → Run. Run it again, whole, whenever it changes:
   it only adds what is missing.
2. **Say where Orbit lives.** Authentication → URL Configuration. Set *Site
   URL* to the address Orbit is served from, and add every address people sign
   in from under *Redirect URLs*: for example `http://localhost:5173/` for
   `npm run dev`, and the hosted address. A link that sends someone to an
   address not on the list is refused.
3. **Email links** work out of the box. Supabase's built-in email is heavily
   rate-limited (a few emails an hour) and meant for trying things out; for
   real use, add an SMTP provider under Authentication → Emails → SMTP Settings.
4. **Notifications.** See *Setting up notifications* below.
5. **Google.** In [Google Cloud Console](https://console.cloud.google.com/)
   → APIs & Services: set up the OAuth consent screen, then Credentials →
   Create credentials → OAuth client ID → *Web application*. Under *Authorized
   redirect URIs* add
   `https://zteqzxfqodbhbrtzrmdf.supabase.co/auth/v1/callback`. Copy the client
   ID and secret into Supabase under Authentication → Sign In / Providers →
   Google, and turn it on. Until then, *Continue with Google* shows Supabase's
   "provider is not enabled" error.

## What the app stores

People, events, reminders, lists, trips, the chosen theme, and your name live
under seven keys (`crm-people-v1`, `crm-events-v1`, `crm-reminders-v1`,
`crm-collections-v1`, `crm-trips-v1`, `crm-theme-v1`, `crm-owner-v1`). Three
more remember small things: that the Trips notice was read
(`crm-trips-notice-v1`), that the pinned-events offer was answered
(`crm-trips-events-offer-v1`), and when the last backup file was made
(`crm-backup-file-v1`). Lists are called
collections in the code, because "list" already means the people list there.
The app reads and writes them through an async `window.storage` object.

When signed in, `src/cloudStorage.js` provides that object, backed by the
account (see [Accounts](#accounts)). Without accounts, `src/storage.js` provides
it, backed by `localStorage` and namespaced under an `orbit:` prefix. Writes are allowed to fail loudly — the app already
catches a rejected write and tells you the change did not save, which is the
honest outcome when the browser refuses to persist (private mode, exhausted
quota, blocked site data).

Trip photos never go through `window.storage`, so they are never in
`localStorage` and never in the account. They are Blobs in IndexedDB, in a
database called `orbit-photos` with a `photos` store (full size) and a
`thumbs` store, both keyed by photo id. Only `src/photoStore.js` touches it.
Its exports (`save`, `get`, `getThumbnail`, `delete`, `listForTrip`, and a few
more) are the whole interface, so moving photos to cloud storage later (to a
Supabase Storage bucket, say) means reimplementing that one file. The first
photo saved on each visit asks the browser to keep Orbit's data
(`navigator.storage.persist()`), which makes it less likely to be cleared when
space runs short.

There is a **Back up** button in the app that exports every record as JSON (trip
records included, photos not), and a **Restore** button that reads it back. A
pasted backup from before trips existed leaves trips as they are. Without accounts, use them;
`localStorage` is per-browser and per-device. Older backups that predate reminders or lists still restore —
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

## Maps, place search, and cost

Map tiles come from [Stadia Maps](https://stadiamaps.com) (Alidade Smooth,
and Alidade Smooth Dark under the Orbit theme). Stadia recognises the live
site by its domain, set on the property in the Stadia dashboard, so no key is
in the code; `localhost` works without one. The free plan is for
non-commercial use only; a commercial Orbit needs a paid plan.

Place search comes from Stadia too (its geocoding autocomplete), recognised
by domain the same way. A search costs more credits than a tile, so the app
waits for a pause in typing, keeps requests at least 300 ms apart and
remembers answers for the visit. Both are entries in
[`src/mapConfig.js`](src/mapConfig.js).

When either service cannot be reached, the app says so and keeps working:
place search points to the other two ways of adding a stop, and a map that
cannot load offers to try again.

## Known lint warnings

`npm run lint` reports two pre-existing warnings in `src/PersonalCRM.jsx`, both
harmless and left alone so the file stays as it was written:

- `totalCount` is defined but never used — dead helper.
- A `useMemo` is flagged for not listing `ofCircle` in its deps. `ofCircle`
  only closes over `people`, which *is* in the dep array, so the memo is
  correct as written.

### Setting up notifications

1. Run `supabase/schema.sql` again (it adds the notification tables), and
   `supabase/check.sql` to confirm every line says OK.
2. Edge Functions → Deploy a new function → Via Editor. Name it `notify`,
   paste `supabase/functions/notify/index.ts`, and deploy. In its settings,
   turn **off** "Enforce JWT verification": the hourly job signs its calls
   with CRON_SECRET, and test pushes check the signed-in person themselves.
3. Edge Functions → Secrets: add `VAPID_PUBLIC_KEY` (the same value as
   `VITE_VAPID_PUBLIC_KEY` in `.env`), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (`mailto:` and your email) and `CRON_SECRET` (long random text). The
   private key never goes in the repo. A new pair can be made with
   `npx web-push generate-vapid-keys`; the public half then replaces the one
   in `.env`, and everyone turns push on again.
4. SQL Editor: run `supabase/notifications-cron.sql` with `CRON_SECRET`
   replaced by the same value.
5. For email: make a [Resend](https://resend.com) account and add secrets
   `RESEND_API_KEY` and `EMAIL_FROM`. Until a domain you own is verified with
   Resend, it only delivers to the address you signed up to Resend with.
