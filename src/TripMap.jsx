/*
 * The two real maps in Orbit: the trips map, and the small one in the trip
 * form for dropping a pin. Leaflet is big, so this file is only loaded when a
 * map is first shown (PersonalCRM imports it lazily). Everything about how a
 * trip looks, including the popup contents and pin colours, is handed in by
 * the caller; this file only knows about maps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
// Leaflet puts itself on window.L as it loads; the cluster plugin extends that.
import 'leaflet.markercluster';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { createLayerComponent, createElementObject, extendContext } from '@react-leaflet/core';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { TILE_LAYER, WORLD_VIEW } from './mapConfig.js';

const ClusterGroup = createLayerComponent(
  ({ children: _children, ...options }, ctx) => {
    const group = L.markerClusterGroup(options);
    return createElementObject(group, extendContext(ctx, { layerContainer: group }));
  },
  () => {},
);

const escape = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const icons = new Map();
// A round pin in the trip's colour, with its rating written in it, so colour
// is never the only way to tell them apart.
const pinIcon = (color, text, ring) => {
  const key = `${color}|${text}|${ring}`;
  if (!icons.has(key)) {
    icons.set(key, L.divIcon({
      className: 'orbit-pin',
      // A half-star rating ("4.5") needs a smaller size to fit the pin.
      html: `<span style="background:${escape(color)};${text.length > 2 ? 'font-size:10.5px;' : ''}${ring ? `box-shadow:0 0 0 3px ${escape(ring)};` : ''}">${escape(text)}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    }));
  }
  return icons.get(key);
};

const clusterIcon = (cluster) => L.divIcon({
  className: 'orbit-cluster',
  html: `<span>${cluster.getChildCount()}</span>`,
  iconSize: [38, 38],
});

// Frames every point whenever the set of points changes: on first load, and
// again when a filter narrows them down.
function FitToPoints({ points }) {
  const map = useMap();
  const signature = points.map((p) => `${p.lat},${p.lng}`).join(';');
  useEffect(() => {
    if (!points.length) {
      map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom);
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 10);
    } else {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 11 });
    }
    // Only a change in which points there are should move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);
  return null;
}

// Asked for one trip (a card was tapped): frames its stops, then opens the
// popup on its first, zooming into the cluster it hides in if it needs to.
// focus is a new object on every ask, so asking twice for one trip works.
function FocusTrip({ focus, points, markers, cluster }) {
  const map = useMap();
  useEffect(() => {
    const mine = focus ? points.filter((p) => p.tripId === focus.tripId) : [];
    if (!mine.length) return undefined;
    const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const group = cluster.current;
    const show = () => {
      // Clusters are still regrouping after a zoom: wait for them to settle.
      if (group?._inZoomAnimation) { group.once('animationend', show); return; }
      const marker = markers.current.get(mine[0].key);
      if (marker && group) group.zoomToShowLayer(marker, () => marker.openPopup());
    };
    map.closePopup();
    map.once('moveend', show);
    if (mine.length === 1) {
      map.setView([mine[0].lat, mine[0].lng], Math.max(map.getZoom(), 10), { animate });
    } else {
      map.fitBounds(L.latLngBounds(mine.map((p) => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 11, animate });
    }
    return () => {
      map.off('moveend', show);
      group?.off('animationend', show);
    };
    // Only a new ask should move the map, not the points changing under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus]);
  return null;
}

// Light or dark tiles, following the app's theme.
function Tiles({ dark }) {
  return <TileLayer url={dark ? TILE_LAYER.dark : TILE_LAYER.light} attribution={TILE_LAYER.attribution} maxZoom={TILE_LAYER.maxZoom} />;
}

/*
 * points: [{ key, tripId, lat, lng, color, text, label }]
 * dark: draw the dark tiles, for the Orbit theme.
 * focus: { tripId } to bring that trip into view and open its popup, which
 * then takes keyboard focus. A new object each time it is asked.
 * renderPopup(point): the popup's contents. Only the open popup is drawn, so a
 * map with hundreds of pins does not load hundreds of thumbnails.
 */
export function TripsMap({ points, renderPopup, height = 420, dark = false, focus = null, children }) {
  const [openKey, setOpenKey] = useState(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const cluster = useRef(null);
  const focusFor = useRef(null);
  useEffect(() => {
    focusFor.current = focus ? focus.tripId : null;
  }, [focus]);
  // A popup opened for a tapped card takes focus, so the keyboard lands on
  // "Open trip" rather than back on the card, far from the map.
  useEffect(() => {
    const p = openKey && points.find((x) => x.key === openKey);
    if (!p || p.tripId !== focusFor.current) return;
    focusFor.current = null;
    mapRef.current?.getContainer().querySelector('.leaflet-popup-content button')?.focus({ preventScroll: true });
  }, [openKey, points]);
  return (
    <MapContainer
      ref={mapRef}
      center={WORLD_VIEW.center}
      zoom={WORLD_VIEW.zoom}
      minZoom={1}
      worldCopyJump
      style={{ height, width: '100%' }}
      className="orbit-map"
    >
      <Tiles dark={dark} />
      <FitToPoints points={points} />
      <FocusTrip focus={focus} points={points} markers={markers} cluster={cluster} />
      <ClusterGroup ref={cluster} showCoverageOnHover={false} maxClusterRadius={46} iconCreateFunction={clusterIcon}>
        {points.map((p) => (
          <Marker
            key={p.key}
            ref={(m) => {
              if (m) markers.current.set(p.key, m);
              else markers.current.delete(p.key);
            }}
            position={[p.lat, p.lng]}
            icon={pinIcon(p.color, p.text)}
            title={p.label}
            alt={p.label}
            eventHandlers={{
              popupopen: () => setOpenKey(p.key),
              popupclose: () => setOpenKey((k) => (k === p.key ? null : k)),
            }}
          >
            <Popup minWidth={210} maxWidth={260} autoPanPadding={[24, 24]}>
              {openKey === p.key ? renderPopup(p) : null}
            </Popup>
          </Marker>
        ))}
      </ClusterGroup>
      {children}
    </MapContainer>
  );
}

function Picker({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

// Frames the stops already added, once, when the map first appears. After
// that the view is the user's.
function FrameOnce({ stops }) {
  const map = useMap();
  const first = useRef(stops);
  useEffect(() => {
    const s = first.current;
    if (s.length === 1) map.setView([s[0].lat, s[0].lng], 8);
    else if (s.length > 1) map.fitBounds(L.latLngBounds(s.map((x) => [x.lat, x.lng])), { padding: [30, 30], maxZoom: 9 });
  }, [map]);
  return null;
}

function FollowPending({ pending }) {
  const map = useMap();
  useEffect(() => {
    if (pending && !map.getBounds().contains([pending.lat, pending.lng])) map.panTo([pending.lat, pending.lng]);
  }, [map, pending]);
  return null;
}

/*
 * The trip form's map: tap anywhere to drop a pin. Stops already on the trip
 * show numbered; the pin being placed shows in the accent colour.
 */
export function PickMap({ stops, pending, onPick, stopColor, pendingColor, height = 300, dark = false }) {
  const numbered = useMemo(() => stops.map((s, i) => ({ ...s, n: i + 1 })), [stops]);
  return (
    <MapContainer
      center={WORLD_VIEW.center}
      zoom={WORLD_VIEW.zoom}
      minZoom={1}
      worldCopyJump
      style={{ height, width: '100%', cursor: 'crosshair' }}
      className="orbit-map"
    >
      <Tiles dark={dark} />
      <FrameOnce stops={stops} />
      <FollowPending pending={pending} />
      <Picker onPick={onPick} />
      {numbered.map((s) => (
        <Marker key={`${s.n}-${s.lat}-${s.lng}`} position={[s.lat, s.lng]} icon={pinIcon(stopColor, String(s.n))}
          title={`Stop ${s.n}: ${s.name}`} alt={`Stop ${s.n}: ${s.name}`} keyboard={false} />
      ))}
      {pending && (
        <Marker position={[pending.lat, pending.lng]} icon={pinIcon(pendingColor, '+', '#ffffff')}
          title="New pin" alt="New pin" keyboard={false} />
      )}
    </MapContainer>
  );
}
