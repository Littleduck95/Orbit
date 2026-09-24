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
means what it says. If two devices change the same kind of thing (say, both
edit people) the later save wins.

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

People, events, reminders, lists, the chosen theme, and your name live under
six keys (`crm-people-v1`, `crm-events-v1`, `crm-reminders-v1`,
`crm-collections-v1`, `crm-theme-v1`, `crm-owner-v1`). Lists are called
collections in the code, because "list" already means the people list there.
The app reads and writes them through an async `window.storage` object.

When signed in, `src/cloudStorage.js` provides that object, backed by the
account (see [Accounts](#accounts)). Without accounts, `src/storage.js` provides
it, backed by `localStorage` and namespaced under an `orbit:` prefix. Writes are allowed to fail loudly — the app already
catches a rejected write and tells you the change did not save, which is the
honest outcome when the browser refuses to persist (private mode, exhausted
quota, blocked site data).

There is a **Back up** button in the app that exports everything as JSON, and a
**Restore** button that reads it back. Without accounts, use them;
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
