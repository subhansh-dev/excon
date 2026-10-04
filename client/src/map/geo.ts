/** Real-world anchoring for scenario decks: grid (0..200)² ↔ WGS-84 window. */

export interface GeoWindow {
  name: string;
  origin: { lat: number; lon: number };
  span: { lat: number; lon: number };
  attribution?: string;
}

/** Grid (x, y) → [lat, lng]. No window → the classic synthetic plane (identity). */
export function gridToLatLng(geo: GeoWindow | null, x: number, y: number): [number, number] {
  if (!geo) return [y, x];
  return [geo.origin.lat + (y / 200) * geo.span.lat, geo.origin.lon + (x / 200) * geo.span.lon];
}

/** Map units per grid cell → meters (identity 1 on the synthetic plane, where Leaflet counts units). */
export function metersPerGridUnit(geo: GeoWindow | null): number {
  return geo ? (geo.span.lat * 111320) / 200 : 1;
}

export function windowBounds(geo: GeoWindow): [[number, number], [number, number]] {
  return [
    [geo.origin.lat, geo.origin.lon],
    [geo.origin.lat + geo.span.lat, geo.origin.lon + geo.span.lon],
  ];
}

export const fmtLat = (v: number) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? "N" : "S"}`;
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? "E" : "W"}`;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
