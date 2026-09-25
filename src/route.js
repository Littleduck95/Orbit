/*
 * Public pages, by address: anyone can open these, signed in or not.
 *
 *   <base>u/<username>         a person's page
 *   <base>u/<username>/<year>  one year of it
 *   <base>c/<entry id>         a catalog entry's page
 *
 * Everything else is the app itself, behind sign-in. <base> is where the site
 * is served from (/Orbit/ on GitHub Pages, / in development). GitHub Pages
 * has no routes of its own, so the build also writes the page as 404.html,
 * which it serves for any address it does not have (see vite.config.js).
 */

const USERNAME = /^[a-z][a-z0-9._]{2,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

// { kind: 'profile', username, year } | { kind: 'catalog', id } | null
export const readRoute = (pathname, base = BASE) => {
  if (typeof pathname !== 'string' || !pathname.startsWith(base)) return null;
  const parts = pathname.slice(base.length).split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return ''; }
  });
  if (parts[0] === 'u' && parts.length >= 2 && parts.length <= 3) {
    const username = parts[1].toLowerCase().replace(/^@/, '');
    if (!USERNAME.test(username)) return null;
    if (parts.length === 2) return { kind: 'profile', username, year: null };
    if (!/^\d{4}$/.test(parts[2])) return null;
    const year = Number(parts[2]);
    return year >= 1900 && year <= 2200 ? { kind: 'profile', username, year } : null;
  }
  if (parts[0] === 'c' && parts.length === 2 && UUID.test(parts[1].toLowerCase())) return { kind: 'catalog', id: parts[1].toLowerCase() };
  return null;
};

export const profilePath = (username, year = null, base = BASE) => `${base}u/${encodeURIComponent(username)}${year ? `/${year}` : ''}`;
export const catalogPath = (id, base = BASE) => `${base}c/${id}`;

// The full address of a page, for sharing.
export const pageUrl = (path) => (typeof window === 'undefined' ? path : `${window.location.origin}${path}`);
