import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// A sign-in link that failed (expired, already used) comes back with the
// reason in the address. It is read and cleared before the client starts, so
// it is shown once on the sign-in screen instead of lingering in the URL.
const readRedirectError = () => {
  if (!url || !key) return '';
  const { hash, search, pathname } = window.location;
  const params = new URLSearchParams(hash.startsWith('#') && !hash.startsWith('#share=') ? hash.slice(1) : '');
  const query = new URLSearchParams(search);
  const found = params.get('error_description') || query.get('error_description');
  if (!found) return '';
  query.delete('error'); query.delete('error_code'); query.delete('error_description');
  const rest = query.toString();
  window.history.replaceState(null, '', pathname + (rest ? `?${rest}` : ''));
  return found.replace(/\+/g, ' ');
};

export const redirectError = readRedirectError();

// Null when no project is configured (see .env), in which case Orbit runs
// without accounts and saves only in this browser.
export const supabase = url && key
  ? createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // The implicit flow lets an email link be opened on a different device
      // or browser from the one that asked for it; PKCE would refuse that.
      flowType: 'implicit',
    },
  })
  : null;
