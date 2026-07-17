// Web implementation of react-native-maps backed by Leaflet + CARTO light
// tiles (the same light-grey look as the design mockups). Supports the API
// surface the app uses: MapView (initialRegion, fitToCoordinates,
// animateToRegion, onMapReady, scroll/zoom toggles), Marker (custom children,
// anchor, flat rotation, zIndex), Polyline and Circle. Native builds never
// touch this file (see metro.config.js resolver alias).
//
// NOTE: CARTO basemaps are free for non-commercial use with attribution —
// swap the tile URL for a keyed provider before a real launch.
const React = require('react');
const ReactDOM = require('react-dom');
const { View } = require('react-native');
const L = require('leaflet');
require('leaflet/dist/leaflet.css');

// Voyager = full detail (street names, POIs, transit) — closest free style
// to the Google/Apple maps look; data is real OpenStreetMap.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const MapCtx = React.createContext(null);

/**
 * True while the leaflet map still owns its DOM panes. React StrictMode
 * double-mounts effects, so children can briefly hold a context value that
 * points at a map instance that was already remove()d — adding a layer to it
 * throws deep inside leaflet. Skip; the context flips to the live instance
 * on the very next render.
 */
function isAlive(map) {
  return !!map && !!map._panes && !!map._panes.overlayPane;
}

function zoomForRegion(region) {
  const delta = Math.max(region.longitudeDelta ?? 0.05, region.latitudeDelta ?? 0.05);
  return Math.max(3, Math.min(18, Math.round(Math.log2(360 / delta))));
}

function MapView(props) {
  const {
    style,
    children,
    initialRegion,
    onMapReady,
    onLayout,
    onRegionChangeComplete,
    scrollEnabled = true,
    zoomEnabled = true,
    pointerEvents,
  } = props;
  const divRef = React.useRef(null);
  const onLayoutRef = React.useRef(onLayout);
  onLayoutRef.current = onLayout;
  const onRegionChangeCompleteRef = React.useRef(onRegionChangeComplete);
  onRegionChangeCompleteRef.current = onRegionChangeComplete;
  const [map, setMap] = React.useState(null);

  React.useImperativeHandle(props.ref, () => ({
    fitToCoordinates(coords, options = {}) {
      const m = divRef.current?._leafletMap;
      if (!m || !coords?.length) return;
      m.invalidateSize(); // container may have just been laid out
      const bounds = L.latLngBounds(coords.map((c) => [c.latitude, c.longitude]));
      const pad = { top: 40, right: 40, bottom: 40, left: 40, ...(options.edgePadding ?? {}) };
      // Never let padding eat the viewport — keep ≥30% of each axis usable.
      const size = m.getSize();
      const scaleAxis = (a, b, dim) => {
        const total = a + b;
        const max = dim * 0.7;
        const f = total > max && total > 0 ? max / total : 1;
        return [Math.round(a * f), Math.round(b * f)];
      };
      const [padLeft, padRight] = scaleAxis(pad.left, pad.right, size.x);
      const [padTop, padBottom] = scaleAxis(pad.top, pad.bottom, size.y);
      m.fitBounds(bounds, {
        paddingTopLeft: [padLeft, padTop],
        paddingBottomRight: [padRight, padBottom],
        animate: options.animated !== false,
        maxZoom: 17,
      });
    },
    animateToRegion(region, _duration) {
      const m = divRef.current?._leafletMap;
      if (!m || !region) return;
      m.setView([region.latitude, region.longitude], zoomForRegion(region), { animate: true });
    },
    animateCamera() {},
  }));

  React.useEffect(() => {
    const node = divRef.current;
    if (!node) return undefined;
    const region = initialRegion ?? { latitude: 17.9583, longitude: -76.8822, longitudeDelta: 0.07 };
    const m = L.map(node, {
      zoomControl: false,
      attributionControl: true,
      dragging: scrollEnabled,
      scrollWheelZoom: zoomEnabled,
      touchZoom: zoomEnabled,
      doubleClickZoom: zoomEnabled,
      boxZoom: false,
      keyboard: false,
    });
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 20 }).addTo(m);
    m.setView([region.latitude, region.longitude], zoomForRegion(region));
    node._leafletMap = m;

    // Leaflet measures its container once — keep it honest as layout settles.
    // Also drive the RN onLayout contract from here: react-native-web's own
    // onLayout has proven unreliable inside this tree, and LiveTripMap sizes
    // its frame padding from it.
    const reportLayout = () => {
      const { clientWidth, clientHeight } = node;
      if (clientWidth > 0 && onLayoutRef.current) {
        onLayoutRef.current({ nativeEvent: { layout: { x: 0, y: 0, width: clientWidth, height: clientHeight } } });
      }
    };
    const observer = new ResizeObserver(() => {
      m.invalidateSize();
      reportLayout();
    });
    observer.observe(node);
    reportLayout();

    // moveend fires after pans AND zooms — matches RN's onRegionChangeComplete.
    m.on('moveend', () => {
      const cb = onRegionChangeCompleteRef.current;
      if (!cb) return;
      const c = m.getCenter();
      const b = m.getBounds();
      cb({
        latitude: c.lat,
        longitude: c.lng,
        latitudeDelta: Math.abs(b.getNorth() - b.getSouth()),
        longitudeDelta: Math.abs(b.getEast() - b.getWest()),
      });
    });

    setMap(m);
    if (onMapReady) setTimeout(() => onMapReady(), 0);
    return () => {
      observer.disconnect();
      m.remove();
      node._leafletMap = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!map) return;
    const toggle = (handler, on) => (on ? handler.enable() : handler.disable());
    toggle(map.dragging, scrollEnabled);
    toggle(map.scrollWheelZoom, zoomEnabled);
    toggle(map.touchZoom, zoomEnabled);
    toggle(map.doubleClickZoom, zoomEnabled);
  }, [map, scrollEnabled, zoomEnabled]);

  return React.createElement(
    View,
    { style: [{ overflow: 'hidden', minHeight: 120 }, style], pointerEvents },
    React.createElement('div', {
      ref: divRef,
      style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
    }),
    React.createElement(MapCtx.Provider, { value: map }, map ? children : null),
  );
}

/** Default pin for markers without custom children (Uber-blue teardrop). */
function defaultPinHtml() {
  return (
    '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 1C7.3 1 1 7.2 1 14.8 1 25 15 37 15 37s14-12 14-22.2C29 7.2 22.7 1 15 1z" fill="#1F7CF6" stroke="#fff" stroke-width="2"/>' +
    '<circle cx="15" cy="14.5" r="5" fill="#fff"/></svg>'
  );
}

function Marker(props) {
  const { coordinate, anchor, rotation = 0, zIndex, children } = props;
  const map = React.useContext(MapCtx);
  const hasChildren = React.Children.count(children) > 0;
  const [container, setContainer] = React.useState(null);
  const markerRef = React.useRef(null);

  React.useEffect(() => {
    if (!isAlive(map)) return undefined;
    const icon = hasChildren
      ? L.divIcon({ className: 'vc-marker', html: '', iconSize: [0, 0] })
      : L.divIcon({ className: 'vc-marker', html: defaultPinHtml(), iconSize: [30, 38], iconAnchor: [15, 37] });
    const m = L.marker([coordinate.latitude, coordinate.longitude], { icon, interactive: false });
    m.addTo(map);
    if (hasChildren) {
      const el = document.createElement('div');
      m.getElement().appendChild(el);
      setContainer(el);
    }
    markerRef.current = m;
    return () => {
      try {
        m.remove();
      } catch {
        /* map already torn down */
      }
      markerRef.current = null;
      setContainer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hasChildren]);

  React.useEffect(() => {
    markerRef.current?.setLatLng([coordinate.latitude, coordinate.longitude]);
  }, [coordinate.latitude, coordinate.longitude]);

  React.useEffect(() => {
    if (zIndex != null) markerRef.current?.setZIndexOffset(zIndex * 100);
  }, [zIndex]);

  if (!container || !hasChildren) return null;
  const ax = anchor?.x ?? 0.5;
  const ay = anchor?.y ?? 1;
  // Translate the anchor point onto the coordinate, then rotate around it.
  const wrapStyle = {
    position: 'absolute',
    transform: `translate(${-ax * 100}%, ${-ay * 100}%) rotate(${rotation}deg)`,
    transformOrigin: `${ax * 100}% ${ay * 100}%`,
  };
  return ReactDOM.createPortal(React.createElement('div', { style: wrapStyle }, children), container);
}

function Polyline({ coordinates, strokeColor = '#1F7CF6', strokeWidth = 4 }) {
  const map = React.useContext(MapCtx);
  const layerRef = React.useRef(null);

  React.useEffect(() => {
    if (!isAlive(map)) return undefined;
    const line = L.polyline([], { color: strokeColor, weight: strokeWidth, lineCap: 'round', lineJoin: 'round', interactive: false });
    line.addTo(map);
    layerRef.current = line;
    return () => {
      try {
        line.remove();
      } catch {
        /* map already torn down */
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  React.useEffect(() => {
    layerRef.current?.setLatLngs((coordinates ?? []).map((c) => [c.latitude, c.longitude]));
  }, [coordinates]);

  React.useEffect(() => {
    layerRef.current?.setStyle({ color: strokeColor, weight: strokeWidth });
  }, [strokeColor, strokeWidth]);

  return null;
}

function Circle({ center, radius = 500, strokeColor = 'rgba(31,124,246,0.4)', fillColor = 'rgba(31,124,246,0.1)' }) {
  const map = React.useContext(MapCtx);
  const layerRef = React.useRef(null);

  React.useEffect(() => {
    if (!isAlive(map)) return undefined;
    // rgba strings carry the alpha, so opacities stay at 1.
    const circle = L.circle([center.latitude, center.longitude], {
      radius,
      color: strokeColor,
      fillColor,
      weight: 1.5,
      opacity: 1,
      fillOpacity: 1,
      interactive: false,
    });
    circle.addTo(map);
    layerRef.current = circle;
    return () => {
      try {
        circle.remove();
      } catch {
        /* map already torn down */
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  React.useEffect(() => {
    layerRef.current?.setLatLng([center.latitude, center.longitude]);
    layerRef.current?.setRadius(radius);
  }, [center.latitude, center.longitude, radius]);

  return null;
}

const Callout = () => null;

Object.defineProperty(exports, '__esModule', { value: true });
exports.default = MapView;
exports.Marker = Marker;
exports.Polyline = Polyline;
exports.Circle = Circle;
exports.Callout = Callout;
exports.PROVIDER_GOOGLE = 'google';
exports.PROVIDER_DEFAULT = undefined;
