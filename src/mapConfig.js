/*
 * Where map tiles and place search come from. Both are free, keyless
 * OpenStreetMap services, fine for personal use but not built for heavy
 * traffic. Moving to a paid provider (MapTiler, Stadia, LocationIQ,
 * Geoapify...) means changing these two entries, nothing else.
 *
 * Usage policies:
 *   https://operations.osmfoundation.org/policies/tiles/
 *   https://operations.osmfoundation.org/policies/nominatim/
 */

export const TILE_LAYER = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  // Required by OpenStreetMap's licence; shown in the corner of every map.
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export const GEOCODER = {
  url: 'https://nominatim.openstreetmap.org/search',
  // Nominatim allows one request a second from any one user, at most.
  minGapMs: 1000,
  limit: 5,
};

// Before any trip exists: most of the inhabited world, no particular country.
export const WORLD_VIEW = { center: [25, 5], zoom: 2 };
