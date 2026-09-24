import { useEffect, useState } from 'react';
import {
  clearCache, cloudStorage, localEntries, parkLocal, readAccountState, replaceAccount,
} from './cloudStorage.js';
import {
  changeEmail, deleteAccount, friendsApi, loadProfile, setPassword, updateProfile, usernameAvailable,
} from './accountApi.js';
import { NewPassword, ProfileSetup, Screen, SignIn, css, returnTo } from './SignIn.jsx';
import { notificationsApi } from './notifications.js';

/*
 * Stands in front of the app when Orbit has a Supabase project (see .env).
 * Nobody reaches their data without signing in (with a password, an emailed
 * link, or Google), and once they have, window.storage is their account.
 * An account with no username yet is asked for one first.
 *
 * The app is only drawn once the account has been read, so it never starts
 * empty and saves that emptiness over what the account holds.
 */

// A share link (#share=…) or a friend's code (#add=…) opened while signed out
// would be lost on the way through sign-in, so it is held here and put back
// before the app looks.
const PENDING_SHARE = 'orbit-pending-share';
const holdShare = () => {
  try {
    if (/^#(share|add)=/.test(window.location.hash)) localStorage.setItem(PENDING_SHARE, window.location.hash);
  } catch { /* the link just is not carried through */ }
};
const restoreShare = () => {
  try {
    const held = localStorage.getItem(PENDING_SHARE);
    localStorage.removeItem(PENDING_SHARE);
    if (held && !/^#(share|add)=/.test(window.location.hash)) {
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

export default function Account({ client, children }) {
  const [session, setSession] = useState(undefined);
  const [phase, setPhase] = useState({ name: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  // undefined while being read; null when the account has none yet. When it
  // cannot be read (no connection, or the setup script not yet run) Orbit
  // opens anyway, without one.
  const [profile, setProfile] = useState(undefined);
  const [recovering, setRecovering] = useState(false);
  const userId = session?.user?.id || null;

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s || null);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!userId) { setProfile(undefined); return undefined; }
    let live = true;
    loadProfile(client, userId).then(
      (r) => { if (live) setProfile(r.missing ? false : r.profile); },
      () => { if (live) setProfile(false); },
    );
    return () => { live = false; };
  }, [client, userId]);

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
  if (recovering) return <NewPassword client={client} onDone={() => setRecovering(false)} />;

  if (phase.name === 'opening' || profile === undefined) return <Screen><p className="muted">Opening your Orbit…</p></Screen>;
  if (profile === null && phase.name !== 'failed') {
    return <ProfileSetup client={client} user={session.user} onDone={setProfile} onSignOut={signOut} />;
  }

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
      {children({
        key: userId,
        account: {
          email: session.user.email || '',
          // How they can sign in: 'email' (a password or an emailed link), 'google'.
          providers: session.user.app_metadata?.providers || [],
          profile: profile || null,
          signOut,
          checkUsername: (name) => usernameAvailable(client, name),
          friends: friendsApi(client),
          notifications: notificationsApi(client, userId, `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`),
          // The link a friend's QR code opens: this page, with their username.
          addLink: profile ? `${returnTo()}#add=${profile.username}` : '',
          updateProfile: async (changes) => {
            const next = await updateProfile(client, userId, changes);
            if (next) setProfile(next);
            return next;
          },
          changeEmail: (email) => changeEmail(client, email, returnTo()),
          changePassword: (password) => setPassword(client, password),
          deleteAccount: async () => {
            await deleteAccount(client);
            clearCache(localStorage, userId);
            delete window.storage;
            // The account is gone, so only this device's session is left to clear.
            await client.auth.signOut({ scope: 'local' });
          },
        },
      })}
    </>
  );
}
