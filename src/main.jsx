import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installStorage } from './storage.js';
import { supabase } from './supabase.js';
import { registerWorker } from './notifications.js';
import Account from './Account.jsx';
import PersonalCRM from './PersonalCRM.jsx';
import Recovery from './Recovery.jsx';

// With a Supabase project configured, Account signs the person in and gives
// window.storage their account before the app is drawn. Without one, Orbit
// saves in this browser as it always has; that must be installed before the
// app mounts, since PersonalCRM reads window.storage on its first effect.
if (!supabase) installStorage();

// The service worker shows push notifications; it caches nothing. Only the
// built site registers it at load, so development never runs a stale one.
if (supabase && import.meta.env.PROD) registerWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Recovery>
      {supabase ? (
        <Account client={supabase}>
          {({ key, account }) => <PersonalCRM key={key} account={account} />}
        </Account>
      ) : (
        <PersonalCRM />
      )}
    </Recovery>
  </StrictMode>,
);
