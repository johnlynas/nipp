/// <reference types="google.maps" />
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { ZoomIn, ZoomOut, Maximize2, MapPin, TriangleAlert } from 'lucide-react';

// ---------------------------------------------------------------------------
// Design constants — the org-chart page's zoom controls are replicated here:
// same MIN/MAX-style clamping (Google Maps exposes 3..21), a fixed +1/-1 step,
// and the "Reset view" (Maximize2) behaviour; overlay styling matches the chart.
// ---------------------------------------------------------------------------
const MIN_ZOOM = 3;
const MAX_ZOOM = 21;
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 54.5979, lng: -5.926 }; // Belfast — Northern Ireland default
const DEFAULT_ZOOM = 11;
const LOCATED_ZOOM = 16;

// Marker ctor from the latest load (client-only). `maps`-library classes are
// accessed per-load where needed; the map instance itself lives in a ref.
let markerCtor: typeof google.maps.Marker | null = null;
// js-api-loader's setOptions() accepts only a single call per page — Fast
// Refresh remounts the effect repeatedly, so track the configured key.
let loaderKey: string | null = null;

function pinSvg(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46"><path d="M17 1C8.2 1 1 8.2 1 17c0 11.5 16 28 16 28s16-16.5 16-28C33 8.2 25.8 1 17 1z" fill="${fill}" stroke="#ffffff" stroke-width="2"/><circle cx="17" cy="17" r="6.5" fill="#ffffff"/></svg>`;
  return `data:image/png;base64,${btoa(svg)}`;
}

interface OrgMapProps {
  orgName: string;
  /** Organization's stored address (from metadata.location.address), if any. */
  address?: string | null;
}

/**
 * Google Maps canvas for the tenant workspace Map page.
 *
 * Centres on the organization's stored location when one exists, and offers a
 * postcode/address field to jump anywhere. Zoom in/out/reset controls are the
 * same overlay pattern as the org chart canvas (same icons, same box).
 */
export default function OrgMap({ orgName, address }: OrgMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  // View the user returns to on "Reset" (located org position, or default).
  const homeViewRef = useRef<{ center: google.maps.LatLngLiteral; zoom: number }>({
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });
  const orgMarkerRef = useRef<google.maps.Marker | null>(null);
  const resultMarkerRef = useRef<google.maps.Marker | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [search, setSearch] = useState('');
  // "Locating…" / "No results" — mirrors the org-chart search status line.
  const [status, setStatus] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Boot: load the Maps JS API (maps + geocoding + marker libraries) and
  // initialise the map. Missing key → placeholder card so the page still
  // renders usefully.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !containerRef.current) {
      setNoKey(true);
      return;
    }

    let cancelled = false;
    setOptions({ key: apiKey, v: 'weekly' });

    (async () => {
      const g = await importLibrary('maps');
      const geoLib = await importLibrary('geocoding');
      const markerLib = await importLibrary('marker');
      if (cancelled || !containerRef.current) return;

      markerCtor = markerLib.Marker;
      const map = new g.Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        // scrollWheelZoom is the Maps default (true) — wheel-to-zoom works out of the box,
        // matching the org chart canvas's native wheel handler.
        fullscreenControl: false, // page owns its own reset control (org-chart parity)
        streetViewControl: false,
      });
      mapRef.current = map;
      geocoderRef.current = new geoLib.Geocoder();

      map.addListener('zoom_changed', () => {
        const z = map.getZoom();
        if (typeof z === 'number') setZoomLevel(Math.round(z));
      });
      setMapReady(true);

      // Centre on the org's stored location when one was provided.
      if (address && address.trim()) {
        void geocoderRef.current?.geocode({ address: address.trim() }, (results) => {
          if (cancelled || !mapRef.current) return;
          const loc = results?.[0]?.geometry?.location;
          if (!loc) {
            setStatus('Stored location not found — showing default area');
            return;
          }
          homeViewRef.current = { center: { lat: loc.lat(), lng: loc.lng() }, zoom: LOCATED_ZOOM };
          orgMarkerRef.current?.setMap(null);
          if (!markerCtor) return;
          orgMarkerRef.current = new markerCtor({
            map,
            position: loc,
            title: `${orgName} — ${address}`,
            icon: { url: pinSvg('#1B2A4A'), anchor: new google.maps.Point(17, 45) },
          });
          map.setCenter(loc);
          map.setZoom(LOCATED_ZOOM);
          setStatus(null);
        });
      }
    })().catch((e) => {
      console.error('Google Maps failed to load:', e);
      if (!cancelled) setNoKey(true);
    });

    return () => {
      cancelled = true;
      orgMarkerRef.current?.setMap(null);
      resultMarkerRef.current?.setMap(null);
      orgMarkerRef.current = null;
      resultMarkerRef.current = null;
      mapRef.current = null;
      geocoderRef.current = null;
    };
  }, [orgName, address]);

  // -----------------------------------------------------------------------
  // Org-chart-parity zoom controls: clamp + step + reset.
  // -----------------------------------------------------------------------
  const applyZoom = useCallback((next: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }, []);

  const zoomIn = useCallback(() => applyZoom((mapRef.current?.getZoom() ?? DEFAULT_ZOOM) + 1), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom((mapRef.current?.getZoom() ?? DEFAULT_ZOOM) - 1), [applyZoom]);
  // Reset = return to the home view (org location if located, else default).
  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const { center, zoom } = homeViewRef.current;
    map.setCenter(center);
    map.setZoom(zoom);
  }, []);

  const handleSearch = useCallback((query: string) => {
    const q = query.trim();
    const map = mapRef.current;
    const geocoder = geocoderRef.current;
    if (!q || !map || !geocoder) return;

    setStatus('Locating…');
    void geocode(q, geocoder, map.getBounds() ?? null, (results) => {
      const first = results?.[0];
      if (!first?.geometry?.location) {
        setStatus(`No results found for “${q}”`);
        return;
      }
      resultMarkerRef.current?.setMap(null);
      if (!markerCtor) return;
      resultMarkerRef.current = new markerCtor({
        map,
        position: first.geometry.location,
        title: first.formatted_address ?? q,
        icon: { url: pinSvg('#F5A623'), anchor: new google.maps.Point(17, 45) },
      });
      map.setCenter(first.geometry.location);
      const currentZoom = map.getZoom();
      map.setZoom(Math.max(typeof currentZoom === 'number' ? currentZoom : LOCATED_ZOOM, LOCATED_ZOOM));
      setStatus(`${q} — ${first.formatted_address ?? ''}`.trim());
    });
  }, []);

  // -----------------------------------------------------------------------
  // Render states
  // -----------------------------------------------------------------------
  if (noKey) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas-subtle">
        <div className="mx-4 flex max-w-md flex-col items-center gap-3 rounded-lg border bg-white p-6 text-center" style={{ borderColor: 'var(--color-slate-200)' }}>
          <TriangleAlert className="h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>
            Map unavailable
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-slate-600)' }}>
            A Google Maps API key is required. Set{' '}
            <code className="rounded bg-canvas-subtle px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your
            environment and restart the app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas-subtle">
      <div ref={containerRef} className="h-full w-full" role="application" aria-label={`Map: ${orgName}`} />

      {/* Zoom controls + address field + pin key — fixed overlay, right/top,
          styled exactly like the org chart's control stack. */}
      <div className="absolute right-4 top-4 z-10 flex flex-col items-stretch gap-2">
        {/* Zoom controls (org-chart page parity) */}
        <div className="flex items-center gap-1 rounded-md border bg-white p-1 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
          <button type="button" onClick={zoomIn} aria-label="Zoom in" disabled={!mapReady} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={zoomOut} aria-label="Zoom out" disabled={!mapReady} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={resetView} aria-label="Reset view" disabled={!mapReady} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            <Maximize2 className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs text-slate-500 tabular-nums">z{Math.round(zoomLevel)}</span>
        </div>

        {/* Address / postcode field (same box style as the chart's search) */}
        <div className="w-64 rounded-md border bg-white shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
          <label htmlFor="map-address-search" className="sr-only">
            Search an address or postcode
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch(search);
            }}
          >
            <div className="flex items-center gap-1.5 p-1.5">
              <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                id="map-address-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Address or postcode…"
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: 'var(--color-navy-850)' }}
              />
            </div>
          </form>
          <p
            role="status"
            className={`max-w-[16rem] truncate px-2.5 text-xs leading-tight ${status ? '' : 'invisible'}`}
            style={{ color: 'var(--color-navy-850)', paddingBottom: status ? 8 : 4 }}
          >
            {status ?? 'placeholder'}
          </p>
        </div>

        {/* Pin key */}
        <div className="flex flex-col gap-1.5 rounded-md border bg-white p-2 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }} aria-label="Pin key">
          {[
            { fill: '#1B2A4A', label: `${orgName} (stored)` },
            { fill: '#F5A623', label: 'Search result' },
          ].map(({ fill, label }) => (
            <div key={label} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: fill }} />
              <span className="text-xs leading-none" style={{ color: 'var(--color-navy-850)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Geocode an address/postcode, optionally biased toward a viewport. */
function geocode(
  query: string,
  geocoder: google.maps.Geocoder,
  bounds: google.maps.LatLngBounds | null,
  cb: (results: google.maps.GeocoderResult[] | null) => void,
): void {
  geocoder.geocode({ address: query, bounds }, cb);
}
