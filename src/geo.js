/*
 * Which country, and which US state, a place is in, worked out here on the
 * device from map outlines rather than asked of a web service. That way every
 * stop counts, however it was added (search, a tap on the map, typed
 * coordinates, a shared trip), and nothing about where someone has been leaves
 * the device. The same outlines shade the visited-countries map.
 *
 * Outlines: Natural Earth 1:50m countries (world-atlas) and US Census states
 * (us-atlas), both public domain. They are big, so this file is only loaded
 * when Trips or Recap first needs it (PersonalCRM imports it lazily).
 */
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-50m.json' with { type: 'json' };
import usa from 'us-atlas/states-10m.json' with { type: 'json' };

export const US = 'United States';

// Natural Earth shortens some names to fit on a printed map.
const FULL_NAMES = {
  'United States of America': US,
  'Marshall Is.': 'Marshall Islands', 'N. Mariana Is.': 'Northern Mariana Islands',
  'U.S. Virgin Is.': 'US Virgin Islands', 'S. Geo. and the Is.': 'South Georgia and the South Sandwich Islands',
  'Br. Indian Ocean Ter.': 'British Indian Ocean Territory', 'Pitcairn Is.': 'Pitcairn Islands',
  'Falkland Is.': 'Falkland Islands', 'Cayman Is.': 'Cayman Islands', 'British Virgin Is.': 'British Virgin Islands',
  'Turks and Caicos Is.': 'Turks and Caicos Islands', eSwatini: 'Eswatini', 'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands', 'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis', 'Cook Is.': 'Cook Islands', 'W. Sahara': 'Western Sahara',
  'St. Pierre and Miquelon': 'Saint Pierre and Miquelon', 'Wallis and Futuna Is.': 'Wallis and Futuna',
  'Fr. Polynesia': 'French Polynesia', 'Fr. S. Antarctic Lands': 'French Southern Territories',
  'Eq. Guinea': 'Equatorial Guinea', 'Dominican Rep.': 'Dominican Republic', 'Faeroe Is.': 'Faroe Islands',
  'N. Cyprus': 'Northern Cyprus', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia and Herzegovina', 'Indian Ocean Ter.': 'Australian Indian Ocean Territories',
  'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands', 'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
  'Antigua and Barb.': 'Antigua and Barbuda',
};

const bounds = (geometry) => {
  let w = 180; let s = 90; let e = -180; let n = -90;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polys.forEach((poly) => poly[0].forEach(([x, y]) => {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }));
  return [w, s, e, n];
};

const shapes = (topo, key) => feature(topo, topo.objects[key]).features
  .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
  .map((f) => {
    const raw = f.properties?.name || '';
    return { name: FULL_NAMES[raw] || raw, feature: f, box: bounds(f.geometry) };
  })
  .filter((x) => x.name);

export const COUNTRIES = shapes(world, 'countries');
export const STATES = shapes(usa, 'states');

// Even-odd ray casting across every ring, so holes (a lake, an enclave) count
// as outside.
const inRings = (x, y, rings) => {
  let inside = false;
  rings.forEach((ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
};

const contains = (shape, x, y) => {
  const [w, s, e, n] = shape.box;
  if (x < w || x > e || y < s || y > n) return false;
  const g = shape.feature.geometry;
  return g.type === 'Polygon' ? inRings(x, y, g.coordinates) : g.coordinates.some((p) => inRings(x, y, p));
};

// Outlines this coarse can leave a beach, a pier or a small island just
// outside the line, so a miss looks a little way round before giving up.
const NEAR = [0.04, 0.12, 0.3];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

const find = (list, lat, lng) => {
  const hit = list.find((sh) => contains(sh, lng, lat));
  if (hit) return hit.name;
  for (const d of NEAR) {
    for (const [dx, dy] of DIRS) {
      const near = list.find((sh) => contains(sh, lng + dx * d, lat + dy * d));
      if (near) return near.name;
    }
  }
  return null;
};

const cache = new Map();

// { country, state } for a point; either can be null (the open sea, or
// outside the US for state).
export const whereIs = (lat, lng) => {
  const k = `${lat},${lng}`;
  if (!cache.has(k)) {
    const country = find(COUNTRIES, lat, lng);
    const state = country === US || country === null ? find(STATES, lat, lng) : null;
    cache.set(k, { country: country || (state ? US : null), state });
  }
  return cache.get(k);
};

// The outlines to shade, for the names given.
export const shapesNamed = (countries, states) => ({
  type: 'FeatureCollection',
  features: [
    ...COUNTRIES.filter((c) => countries.has(c.name)).map((c) => ({ ...c.feature, properties: { name: c.name, kind: 'country' } })),
    ...STATES.filter((s) => states.has(s.name)).map((s) => ({ ...s.feature, properties: { name: s.name, kind: 'state' } })),
  ],
});
