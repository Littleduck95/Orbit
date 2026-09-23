import { useEffect, useState } from 'react';
import {
  clearCache, cloudStorage, localEntries, parkLocal, readAccountState, replaceAccount,
} from './cloudStorage.js';
import { redirectError } from './supabase.js';

/*
 * Stands in front of the app when Orbit has a Supabase project (see .env).
 * Nobody reaches their data without signing in, by an emailed link or with
 * Google, and once they have, window.storage is their account.
 *
 * The app is only drawn once the account has been read, so it never starts
 * empty and saves that emptiness over what the account holds.
 */

// A shared-list link (#share=…) opened while signed out would be lost on the
// way through sign-in, so it is held here and put back before the app looks.
const PENDING_SHARE = 'orbit-pending-share';
const holdShare = () => {
  try {
    if (window.location.hash.startsWith('#share=')) localStorage.setItem(PENDING_SHARE, window.location.hash);
  } catch { /* the link just is not carried through */ }
};
const restoreShare = () => {
  try {
    const held = localStorage.getItem(PENDING_SHARE);
    localStorage.removeItem(PENDING_SHARE);
    if (held && !window.location.hash.startsWith('#share=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + held);
    }
  } catch { /* nothing held */ }
};
holdShare();

// Reading the account can move this browser's data into it, which must happen
// once. React's development mode runs effects twice, so a read already under
// way for the same account and attempt is shared rather than started again.
let opening = null;
const openOnce = (id, args) => {
  if (opening?.id !== id) opening = { id, promise: readAccountState(args) };
  return opening.promise;
};

// Where sign-in links and Google send people back to: this page, as it is
// hosted. It must be listed under Redirect URLs in the Supabase dashboard.
const returnTo = () => window.location.origin + window.location.pathname;

const download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const css = `
  .acct { --ink:#15211B; --muted:#5A6B60; --bg:#FBFDFB; --line:#D5DED8; --accent:#72DE88; --bad:#B3261E;
    min-height:100vh; background:var(--bg); color:var(--ink);
    font-family:'Segoe UI', system-ui, sans-serif; line-height:1.5; }
  @media (prefers-color-scheme: dark) {
    .acct { --ink:#E4ECE6; --muted:#9AAB9F; --bg:#111713; --line:#2C3830; --bad:#F2B8B5; }
  }
  .acct-card { max-width:400px; margin:0 auto; padding:56px 16px 40px; }
  .acct h1 { font-size:26px; margin:0 0 8px; letter-spacing:-0.03em; font-weight:600; }
  .acct p { margin:0 0 16px; font-size:15px; }
  .acct .muted { color:var(--muted); font-size:14px; }
  .acct .bad { color:var(--bad); font-size:14px; }
  .acct label { display:block; font-size:13px; font-weight:600; margin:0 0 6px; }
  .acct input { box-sizing:border-box; width:100%; font:inherit; font-size:16px; padding:10px 12px;
    border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--ink); }
  .acct button { font:inherit; font-size:15px; font-weight:600; padding:10px 14px; border-radius:8px;
    cursor:pointer; border:1px solid var(--ink); background:transparent; color:var(--ink); }
  .acct button.primary { background:var(--accent); border-color:var(--accent); color:#15211B; }
  .acct button.wide { width:100%; margin-top:10px; }
  .acct button:disabled { opacity:.6; cursor:default; }
  .acct button:focus-visible, .acct input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .acct .or { display:flex; align-items:center; gap:10px; margin:22px 0; color:var(--muted); font-size:13px; }
  .acct .or::before, .acct .or::after { content:''; flex:1; border-top:1px solid var(--line); }
  .acct .stack button { display:block; width:100%; margin-bottom:10px; text-align:left; }
  .acct-bar { display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap;
    padding:8px 16px; font:14px/1.4 'Segoe UI', system-ui, sans-serif; background:#15211B; color:#FBFDFB; }
  .acct-bar button { font:inherit; font-weight:600; background:transparent; color:inherit;
    border:1px solid currentColor; border-radius:6px; padding:3px 10px; cursor:pointer; }
`;

const Screen = ({ children }) => (
  <main className="acct">
    <style>{css}</style>
    <div className="acct-card">{children}</div>
  </main>
);

const GoogleMark = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 9 }}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

function SignIn({ client }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [problem, setProblem] = useState(redirectError ? `That sign-in link did not work: ${redirectError}` : '');

  const sendLink = async (e) => {
    e.preventDefault();
    const to = email.trim();
    if (!to) { setProblem('Type your email address first.'); return; }
    setBusy(true); setProblem('');
    const { error } = await client.auth.signInWithOtp({ email: to, options: { emailRedirectTo: returnTo() } });
    setBusy(false);
    if (error) setProblem(`The link could not be sent: ${error.message}`);
    else setSentTo(to);
  };

  const google = async () => {
    setBusy(true); setProblem('');
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnTo() } });
    // On success the page is already on its way to Google.
    if (error) { setBusy(false); setProblem(`Google sign-in could not start: ${error.message}`); }
  };

  if (sentTo) {
    return (
      <Screen>
        <h1>Check your email</h1>
        <p>A sign-in link is on its way to <strong>{sentTo}</strong>. Open it on any device to sign in there.</p>
        <p className="muted">Nothing arrived after a few minutes? Look in spam, or try again.</p>
        <button type="button" onClick={() => setSentTo('')}>Use a different address</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <h1>Sign in to Orbit</h1>
      <p className="muted">
        Your people, events, reminders and lists are kept in your account, so they are the same on every device
        you sign in on.
      </p>
      <form onSubmit={sendLink} noValidate>
        <label htmlFor="acct-email">Email</label>
        <input
          id="acct-email" type="email" autoComplete="email" inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
        />
        <button type="submit" className="primary wide" disabled={busy}>Email me a sign-in link</button>
      </form>
      <div className="or">or</div>
      <button type="button" className="wide" onClick={google} disabled={busy}><GoogleMark />Continue with Google</button>
      {problem && <p className="bad" role="alert" style={{ marginTop: 16 }}>{problem}</p>}
    </Screen>
  );
}

export default function Account({ client, children }) {
  const [session, setSession] = useState(undefined);
  const [phase, setPhase] = useState({ name: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  const userId = session?.user?.id || null;

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s || null));
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!userId) {
      delete window.storage;
      return undefined;
    }
    let live = true;
    const ready = (entries, extra = {}) => {
      if (!live) return;
      window.storage = cloudStorage({ client, userId, store: localStorage, entries });
      restoreShare();
      setPhase({ name: 'ready', ...extra });
    };
    (async () => {
      setPhase({ name: 'opening' });
      try {
        const st = await openOnce(`${userId}:${attempt}`, { client, userId, store: localStorage });
        if (!live) return;
        if (st.conflict) setPhase({ name: 'conflict', entries: st.entries });
        else ready(st.entries, { offline: st.offline, moved: st.moved });
      } catch (err) {
        if (live) setPhase({ name: 'failed', message: String(err?.message || err) });
      }
    })();
    return () => { live = false; };
  }, [client, userId, attempt]);

  const signOut = async () => {
    // The copy of the account on this device goes too, so the next person
    // to use it sees nothing of it.
    if (userId) clearCache(localStorage, userId);
    delete window.storage;
    await client.auth.signOut();
  };

  if (session === undefined) return <Screen><p className="muted">Opening Orbit…</p></Screen>;
  if (!session) return <SignIn client={client} />;

  if (phase.name === 'opening') return <Screen><p className="muted">Opening your Orbit…</p></Screen>;

  if (phase.name === 'failed') {
    return (
      <Screen>
        <h1>Orbit could not reach your account</h1>
        <p>Nothing has been lost. Check your connection and try again.</p>
        <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>{' '}
        <button type="button" onClick={signOut}>Sign out</button>
        <details style={{ marginTop: 22 }} className="muted">
          <summary style={{ cursor: 'pointer' }}>What went wrong</summary>
          <p style={{ marginTop: 8 }}>{phase.message}</p>
        </details>
      </Screen>
    );
  }

  if (phase.name === 'conflict') {
    const finish = (entries) => {
      window.storage = cloudStorage({ client, userId, store: localStorage, entries });
      restoreShare();
      setPhase({ name: 'ready' });
    };
    const keepAccount = () => {
      try { parkLocal(localStorage); } catch { /* it simply stays where it is */ }
      finish(phase.entries);
    };
    const useBrowser = async () => {
      setNote('');
      try {
        finish(await replaceAccount({ client, userId, store: localStorage }));
      } catch (err) {
        setNote(`Your account was not changed: ${err?.message || err}`);
      }
    };
    const save = () => {
      try {
        download('orbit-this-browser.json', JSON.stringify(localEntries(localStorage), null, 2));
        setNote('Downloaded. Keep that file somewhere safe.');
      } catch {
        setNote('This browser would not give up its saved data here.');
      }
    };
    return (
      <Screen>
        <h1>Which Orbit do you want?</h1>
        <p>
          Your account already has Orbit data, and this browser also has some saved from before you signed in.
          They are not combined, so pick the one to keep.
        </p>
        <div className="stack">
          <button type="button" className="primary" onClick={keepAccount}>Keep my account’s</button>
          <button type="button" onClick={useBrowser}>Replace my account with this browser’s</button>
          <button type="button" onClick={save}>Download this browser’s copy first</button>
        </div>
        <p className="muted">
          Keeping your account’s puts this browser’s older data out of the way without deleting it.
        </p>
        {note && <p aria-live="polite">{note}</p>}
      </Screen>
    );
  }

  const banner = phase.offline
    ? 'You are offline, so this is the copy from your last visit. Changes will not save until you are back online.'
    : phase.moved ? 'Everything this browser had saved is now in your account.' : '';

  return (
    <>
      {banner && <style>{css}</style>}
      {banner && !phase.dismissed && (
        <div className="acct-bar" role="status">
          <span>{banner}</span>
          <button type="button" onClick={() => setPhase({ ...phase, dismissed: true })}>OK</button>
        </div>
      )}
      {children({ key: userId, account: { email: session.user.email || '', signOut } })}
    </>
  );
}
