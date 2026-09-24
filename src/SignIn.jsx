import { useEffect, useId, useState } from 'react';
import {
  MIN_AGE, MIN_PASSWORD, authMessage, birthdayProblem, cleanUsername, createProfile, displayNameProblem,
  emailProblem, logIn, passwordProblem, sendReset, setPassword, signUp, signUpProblems, usernameAvailable,
  usernameProblem,
} from './accountApi.js';
import { redirectError } from './supabase.js';

/*
 * The screens in front of Orbit: logging in, creating an account, resetting
 * a password, and the one-time step that gives an older account (or one made
 * with Google or an email link) a username, a name and a birthday.
 */

// Where emailed links and Google send people back to: this page, as it is
// hosted. It must be listed under Redirect URLs in the Supabase dashboard.
export const returnTo = () => window.location.origin + window.location.pathname;

export const css = `
  .acct { --ink:#15211B; --muted:#5A6B60; --bg:#FBFDFB; --line:#D5DED8; --accent:#72DE88; --bad:#B3261E; --good:#1F7A3A;
    min-height:100vh; background:var(--bg); color:var(--ink);
    font-family:'Segoe UI', system-ui, sans-serif; line-height:1.5; }
  @media (prefers-color-scheme: dark) {
    .acct { --ink:#E4ECE6; --muted:#9AAB9F; --bg:#111713; --line:#2C3830; --bad:#F2B8B5; --good:#8FE8A2; }
  }
  .acct-card { max-width:400px; margin:0 auto; padding:48px 16px 40px; }
  .acct h1 { font-size:26px; margin:0 0 8px; letter-spacing:-0.03em; font-weight:600; }
  .acct p { margin:0 0 16px; font-size:15px; }
  .acct .muted { color:var(--muted); font-size:14px; }
  .acct .bad { color:var(--bad); font-size:14px; }
  .acct label { display:block; font-size:13px; font-weight:600; margin:0 0 6px; }
  .acct input { box-sizing:border-box; width:100%; font:inherit; font-size:16px; padding:10px 12px;
    border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--ink); }
  .acct input[aria-invalid="true"] { border-color:var(--bad); }
  .acct input[type="date"] { min-height:44px; }
  .acct button { font:inherit; font-size:15px; font-weight:600; padding:10px 14px; border-radius:8px;
    cursor:pointer; border:1px solid var(--ink); background:transparent; color:var(--ink); }
  .acct button.primary { background:var(--accent); border-color:var(--accent); color:#15211B; }
  .acct button.wide { width:100%; margin-top:10px; }
  .acct button.link { border:none; padding:0; font-size:14px; text-decoration:underline; color:var(--muted); }
  .acct button:disabled { opacity:.6; cursor:default; }
  .acct button:focus-visible, .acct input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .acct .or { display:flex; align-items:center; gap:10px; margin:22px 0; color:var(--muted); font-size:13px; }
  .acct .or::before, .acct .or::after { content:''; flex:1; border-top:1px solid var(--line); }
  .acct .stack button { display:block; width:100%; margin-bottom:10px; text-align:left; }
  .acct .field { margin-bottom:14px; }
  .acct .field-note { display:block; font-size:12.5px; margin-top:5px; color:var(--muted); }
  .acct .field-note.bad { color:var(--bad); }
  .acct .field-note.good { color:var(--good); }
  .acct .with-toggle { position:relative; }
  .acct .with-toggle input { padding-right:64px; }
  .acct .with-toggle button { position:absolute; right:6px; top:50%; transform:translateY(-50%);
    font-size:13px; padding:4px 8px; border:none; color:var(--muted); }
  .acct .tabs { display:flex; gap:6px; margin:0 0 22px; padding:4px; border:1px solid var(--line); border-radius:10px; }
  .acct .tabs button { flex:1; border:none; padding:8px 0; font-size:14px; color:var(--muted); }
  .acct .tabs button[aria-pressed="true"] { background:var(--accent); color:#15211B; }
  .acct-bar { display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap;
    padding:8px 16px; font:14px/1.4 'Segoe UI', system-ui, sans-serif; background:#15211B; color:#FBFDFB; }
  .acct-bar button { font:inherit; font-weight:600; background:transparent; color:inherit;
    border:1px solid currentColor; border-radius:6px; padding:3px 10px; cursor:pointer; }
`;

export const Screen = ({ children }) => (
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

// A labelled input with its problem (or its good news) underneath, tied to
// it for screen readers. The problem only shows once the field has been
// left or the form has been tried.
export function Input({ label, value, onChange, problem, shown, note, noteTone, hint, ...rest }) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const say = (left || shown) && problem ? problem : note || hint || '';
  const tone = (left || shown) && problem ? 'bad' : note ? noteTone || '' : '';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setLeft(true)}
        aria-invalid={Boolean((left || shown) && problem)} aria-describedby={say ? `${id}-note` : undefined} {...rest} />
      {say && <span id={`${id}-note`} className={`field-note ${tone}`}>{say}</span>}
    </div>
  );
}

function PasswordInput({ label = 'Password', ...rest }) {
  const [show, setShow] = useState(false);
  const id = useId();
  const [left, setLeft] = useState(false);
  const { value, onChange, problem, shown, hint, autoComplete } = rest;
  const bad = (left || shown) && problem;
  const say = bad ? problem : hint || '';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="with-toggle">
        <input id={id} type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)} onBlur={() => setLeft(true)}
          aria-invalid={Boolean(bad)} aria-describedby={say ? `${id}-note` : undefined} />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {say && <span id={`${id}-note`} className={`field-note ${bad ? 'bad' : ''}`}>{say}</span>}
    </div>
  );
}

// Checks a username against the server a moment after typing stops. Any
// failure to ask (no connection, no table yet) says nothing rather than
// blocking: the database has the final word when the form is sent.
function useUsernameCheck(client, username, own = '') {
  const [state, setState] = useState({ name: '', free: null });
  const name = cleanUsername(username);
  const valid = !usernameProblem(name);
  useEffect(() => {
    if (!valid || name === own) return undefined;
    let live = true;
    const t = setTimeout(() => {
      usernameAvailable(client, name).then((free) => { if (live) setState({ name, free }); }, () => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [client, name, valid, own]);
  if (!valid || name === own || state.name !== name) return null;
  return state.free;
}

const today = () => new Date();
const maxBirthday = () => {
  const d = today();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d.toISOString().slice(0, 10);
};

function Register({ client, onDone, busy, setBusy }) {
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', birthday: '' });
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState('');
  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const problems = signUpProblems(form, today());
  const free = useUsernameCheck(client, form.username);
  const nameProblem = problems.username || (free === false ? 'That username is taken.' : '');

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    setProblem('');
    if (Object.keys(problems).length || free === false) return;
    setBusy(true);
    try {
      const got = await signUp(client, form, returnTo());
      onDone(got.needsConfirm ? { confirm: form.email.trim() } : {});
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Input label="Your name" value={form.displayName} onChange={set('displayName')} autoComplete="name"
        problem={problems.displayName} shown={tried} hint="What friends see. You can change it later." />
      <Input label="Username" value={form.username} onChange={set('username')} autoComplete="username"
        autoCapitalize="none" spellCheck={false} placeholder="e.g. brock_b"
        problem={nameProblem} shown={tried || free === false}
        note={free === true ? `@${cleanUsername(form.username)} is free.` : ''} noteTone="good"
        hint="How friends find you. Letters, numbers, dots and underscores." />
      <Input label="Email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')}
        problem={problems.email} shown={tried} hint="For signing in and resetting your password. Never shown to anyone." />
      <PasswordInput value={form.password} onChange={set('password')} problem={problems.password} shown={tried}
        autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
      <Input label="Birthday" type="date" value={form.birthday} onChange={set('birthday')} max={maxBirthday()} min="1900-01-01"
        autoComplete="bday" problem={problems.birthday} shown={tried}
        hint={`Orbit is for people ${MIN_AGE} and older. Kept private unless you choose to show it.`} />
      <button type="submit" className="primary wide" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
      {problem && <p className="bad" role="alert" style={{ marginTop: 14 }}>{problem}</p>}
    </form>
  );
}

function LogIn({ client, busy, setBusy, onForgot, onLinkSent }) {
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState(redirectError ? `That link did not work: ${redirectError}` : '');

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    setProblem('');
    if (emailProblem(email) || !password) return;
    setBusy(true);
    try {
      await logIn(client, email, password);
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };

  const sendLink = async () => {
    setTried(true);
    setProblem('');
    if (emailProblem(email)) return;
    setBusy(true);
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: returnTo(), shouldCreateUser: false } });
    setBusy(false);
    if (error) setProblem(/signups not allowed|not found/i.test(error.message)
      ? 'There is no account with that email yet. Create one instead.' : authMessage(error));
    else onLinkSent(email.trim());
  };

  return (
    <form onSubmit={submit} noValidate>
      <Input label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail}
        problem={emailProblem(email)} shown={tried} />
      <PasswordInput value={password} onChange={setPw} autoComplete="current-password"
        problem={password ? '' : 'Enter your password.'} shown={tried} />
      <button type="submit" className="primary wide" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p style={{ margin: '12px 0 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="link" onClick={() => onForgot(email)}>Forgot password?</button>
        <button type="button" className="link" onClick={sendLink} disabled={busy}>Email me a sign-in link instead</button>
      </p>
      {problem && <p className="bad" role="alert" style={{ marginTop: 14 }}>{problem}</p>}
    </form>
  );
}

function Forgot({ client, start, onBack, onSent }) {
  const [email, setEmail] = useState(start || '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (emailProblem(email)) return;
    setBusy(true);
    try {
      await sendReset(client, email, returnTo());
      onSent(email.trim());
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <h1>Reset your password</h1>
      <p className="muted">We will email you a link. Open it and choose a new password.</p>
      <form onSubmit={submit} noValidate>
        <Input label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail}
          problem={emailProblem(email)} shown={tried} />
        <button type="submit" className="primary wide" disabled={busy}>Send the link</button>
      </form>
      {problem && <p className="bad" role="alert" style={{ marginTop: 14 }}>{problem}</p>}
      <p style={{ marginTop: 18 }}><button type="button" className="link" onClick={onBack}>Back to log in</button></p>
    </Screen>
  );
}

function Sent({ title, children, onBack }) {
  return (
    <Screen>
      <h1>{title}</h1>
      {children}
      <p className="muted">Nothing arrived after a few minutes? Look in spam, or try again.</p>
      <button type="button" onClick={onBack}>Back to log in</button>
    </Screen>
  );
}

export function SignIn({ client }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [forgotFrom, setForgotFrom] = useState('');
  const [problem, setProblem] = useState('');
  const back = () => { setSent(null); setMode('login'); };

  if (sent?.confirm) {
    return (
      <Sent title="Confirm your email" onBack={back}>
        <p>We sent a link to <strong>{sent.confirm}</strong>. Open it to finish creating your account, then you are in.</p>
      </Sent>
    );
  }
  if (sent?.link) {
    return (
      <Sent title="Check your email" onBack={back}>
        <p>A sign-in link is on its way to <strong>{sent.link}</strong>. Open it on any device to sign in there.</p>
      </Sent>
    );
  }
  if (sent?.reset) {
    return (
      <Sent title="Check your email" onBack={back}>
        <p>If there is an account for <strong>{sent.reset}</strong>, a link to reset the password is on its way.</p>
      </Sent>
    );
  }
  if (mode === 'forgot') return <Forgot client={client} start={forgotFrom} onBack={back} onSent={(e) => setSent({ reset: e })} />;

  const google = async () => {
    setBusy(true);
    setProblem('');
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnTo() } });
    // On success the page is already on its way to Google.
    if (error) { setBusy(false); setProblem(`Google sign-in could not start: ${authMessage(error)}`); }
  };

  return (
    <Screen>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your Orbit'}</h1>
      <p className="muted">
        {mode === 'login'
          ? 'Your people, events, reminders and lists, the same on every device you sign in on.'
          : 'An account keeps everything in Orbit with you, and lets friends find you by your username.'}
      </p>
      <div className="tabs" role="group" aria-label="Log in or create an account">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setProblem(''); }}>Log in</button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setProblem(''); }}>Create account</button>
      </div>
      {mode === 'login' ? (
        <LogIn client={client} busy={busy} setBusy={setBusy}
          onForgot={(e) => { setForgotFrom(e); setMode('forgot'); }} onLinkSent={(e) => setSent({ link: e })} />
      ) : (
        <Register client={client} busy={busy} setBusy={setBusy} onDone={(r) => r.confirm && setSent(r)} />
      )}
      <div className="or">or</div>
      <button type="button" className="wide" onClick={google} disabled={busy}><GoogleMark />Continue with Google</button>
      {problem && <p className="bad" role="alert" style={{ marginTop: 16 }}>{problem}</p>}
    </Screen>
  );
}

// Choosing a new password after opening a reset link.
export function NewPassword({ client, onDone }) {
  const [pw, setPw] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (passwordProblem(pw)) return;
    setBusy(true);
    try {
      await setPassword(client, pw);
      onDone();
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Screen>
      <h1>Choose a new password</h1>
      <form onSubmit={submit} noValidate>
        <PasswordInput label="New password" value={pw} onChange={setPw} problem={passwordProblem(pw)} shown={tried}
          autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
        <button type="submit" className="primary wide" disabled={busy}>Save password</button>
      </form>
      {problem && <p className="bad" role="alert" style={{ marginTop: 14 }}>{problem}</p>}
    </Screen>
  );
}

// A suggestion from an email address or a name: "Brock.Boyer98@…" → "brock.boyer98".
const suggestUsername = (user) => {
  const base = cleanUsername(String(user?.email || '').split('@')[0]).replace(/[^a-z0-9._]/g, '').replace(/[._]{2,}/g, '_').replace(/^[^a-z]+/, '').replace(/[._]+$/, '');
  return base.slice(0, 20);
};

// The one step for an account that has no username yet: made with Google or
// an email link, or before usernames existed.
export function ProfileSetup({ client, user, onDone, onSignOut }) {
  const meta = user?.user_metadata || {};
  const [form, setForm] = useState({
    displayName: meta.full_name || meta.name || '',
    username: suggestUsername(user),
    birthday: '',
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const free = useUsernameCheck(client, form.username);
  const problems = {
    displayName: displayNameProblem(form.displayName),
    username: usernameProblem(form.username) || (free === false ? 'That username is taken.' : ''),
    birthday: birthdayProblem(form.birthday, today()),
  };
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    setProblem('');
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    try {
      onDone(await createProfile(client, user.id, form));
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  return (
    <Screen>
      <h1>One more step</h1>
      <p className="muted">Pick a username so friends can find you, and tell us your name and birthday.</p>
      <form onSubmit={submit} noValidate>
        <Input label="Your name" value={form.displayName} onChange={set('displayName')} autoComplete="name"
          problem={problems.displayName} shown={tried} hint="What friends see." />
        <Input label="Username" value={form.username} onChange={set('username')} autoComplete="username"
          autoCapitalize="none" spellCheck={false} problem={problems.username} shown={tried || free === false}
          note={free === true ? `@${cleanUsername(form.username)} is free.` : ''} noteTone="good"
          hint="Letters, numbers, dots and underscores." />
        <Input label="Birthday" type="date" value={form.birthday} onChange={set('birthday')} max={maxBirthday()} min="1900-01-01"
          autoComplete="bday" problem={problems.birthday} shown={tried}
          hint={`Orbit is for people ${MIN_AGE} and older. Kept private unless you choose to show it.`} />
        <button type="submit" className="primary wide" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
      </form>
      {problem && <p className="bad" role="alert" style={{ marginTop: 14 }}>{problem}</p>}
      <p style={{ marginTop: 18 }}><button type="button" className="link" onClick={onSignOut}>Sign out</button></p>
    </Screen>
  );
}
