/*
 * Where map tiles and place search come from.
 *
 * Tiles: Stadia Maps' Alidade Smooth, a quiet grey map that lets the rating
 * pins stand out, with its dark twin under the Orbit theme. On the live site
 * Stadia recognises the request by its domain (added to the property in the
 * Stadia dashboard), so no key is shipped in the code; localhost works
 * without one. Commercial use needs a paid Stadia plan.
 *   https://docs.stadiamaps.com/authentication/
 *
 * Search: still OpenStreetMap's free Nominatim, which is only fit for light
 * personal use. https://operations.osmfoundation.org/policies/nominatim/
 */

const STADIA = 'https://tiles.stadiamaps.com/tiles';

export const TILE_LAYER = {
  light: `${STADIA}/alidade_smooth/{z}/{x}/{y}{r}.png`,
  dark: `${STADIA}/alidade_smooth_dark/{z}/{x}/{y}{r}.png`,
  // Required by the data licences; shown in the corner of every map.
  attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> '
    + '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
    + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  maxZoom: 20,
};

export const GEOCODER = {
  url: 'https://nominatim.openstreetmap.org/search',
  // Nominatim allows one request a second from any one user, at most.
  minGapMs: 1000,
  limit: 5,
};

// Before any trip exists: most of the inhabited world, no particular country.
export const WORLD_VIEW = { center: [25, 5], zoom: 2 };
