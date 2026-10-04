import { useState } from "react";
import { MapContainer, Rectangle, Tooltip, Polyline, Circle, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { MilMarker } from "../map/MilMarker";
import { MAP, assetColor, obstacleColor } from "../map/palette";
import { summarizeLinks, type LinkSum } from "../map/linkHealth";
import { gridToLatLng, metersPerGridUnit, windowBounds, fmtLat, fmtLon, haversineKm, type GeoWindow } from "../map/geo";
import { sound } from "../sound";

interface Unit {
  id: string; side: string; type: string;
  x: number; y: number; status: string; sidc?: string; confidence?: number;
  wp?: number[][]; age_s?: number;
}
interface Asset {
  id: string; kind: string; status: string; x?: number; y?: number;
  confidence?: number; age_s?: number;
}
interface Obstacle {
  id: string; kind: string; x1: number; y1: number; x2: number; y2: number; label?: string;
}

const BOUNDS: [[number, number], [number, number]] = [[0, 0], [200, 200]];

function gridLines(): [number, number][][] {
  const lines: [number, number][][] = [];
  for (let i = 20; i < 200; i += 20) {
    lines.push([[i, 0], [i, 200]]);
    lines.push([[0, i], [200, i]]);
  }
  return lines;
}

function MapMouseTracker({ onMouseMove, onClick }: { onMouseMove: (lat: number, lng: number) => void; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    mousemove(e) {
      onMouseMove(e.latlng.lat, e.latlng.lng);
    },
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function MapView({
  units, assets, obstacles = [], hot = [], links = [],
  showUnits = true, showAssets = true, height = 440, geo = null,
}: {
  units: Unit[]; assets: Asset[]; obstacles?: Obstacle[]; hot?: string[]; links?: LinkSum[];
  showUnits?: boolean; showAssets?: boolean; height?: number; geo?: GeoWindow | null;
}) {
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [showRings, setShowRings] = useState(false);
  const [showFog, setShowFog] = useState(true);
  const [cursorPos, setCursorPos] = useState<[number, number]>([100, 100]);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [tilesOffline, setTilesOffline] = useState(false);

  const { blackout, degraded } = summarizeLinks(links);
  const P = (x: number, y: number): [number, number] => gridToLatLng(geo, x, y);
  const unitM = metersPerGridUnit(geo);
  const onGeo = !!geo;

  const handleMapClick = (lat: number, lng: number) => {
    if (measuring) {
      sound.playClick();
      if (measurePoints.length >= 2) {
        setMeasurePoints([[lat, lng]]);
      } else {
        setMeasurePoints((pts) => [...pts, [lat, lng]]);
      }
    }
  };

  const measureDistance = (): number | null => {
    if (measurePoints.length < 2) return null;
    const [p1, p2] = measurePoints;
    if (onGeo) return Math.round(haversineKm(p1, p2) * 10) / 10;
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    return Math.round(d * 10) / 10;
  };

  return (
    <div className="tacmap">
      <div className="tac-hud">
        <span className="hud-live">
          <span className="pingwrap"><span className={`pingdot ${degraded ? "amber" : "green"}`} /></span>
          {onGeo ? (
            <>{geo!.name.toUpperCase()} [{fmtLat(cursorPos[0])} {fmtLon(cursorPos[1])}]</>
          ) : (
            <>GRID: SYNTHETIC THEATER [X:{Math.round(cursorPos[1])} Y:{Math.round(cursorPos[0])}]</>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <label style={{ cursor: "pointer", fontSize: 10 }}>
            <input type="checkbox" checked={showRings} onChange={() => setShowRings((v) => !v)} /> RINGS
          </label>
          <label style={{ cursor: "pointer", fontSize: 10 }}>
            <input type="checkbox" checked={showFog} onChange={() => setShowFog((v) => !v)} /> UNCERTAINTY
          </label>
          <button
            className={`btn ghost`}
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => {
              setMeasuring(!measuring);
              setMeasurePoints([]);
              sound.playClick();
            }}
          >
            {measuring ? "✕ CANCEL RULER" : "📐 MEASURE"}
          </button>
          <span className="hud-dim">
            {onGeo
              ? `WGS-84 REAL TERRAIN${tilesOffline ? " · BASE TILES OFFLINE" : " · © OPENSTREETMAP"}`
              : "DATUM: WGS-84 (SIM) · 1:25,000"}
          </span>
        </span>
      </div>

      {blackout && <div className="tac-banner">RF INTERFERENCE // COMMS BLACKOUT ACTIVE</div>}

      {measuring && (
        <div style={{ background: "#fffbeb", color: "#92400e", padding: "4px 12px", fontSize: 11, fontFamily: "var(--mono)", borderBottom: "1px solid #fde68a" }}>
          <b>RULER ACTIVE:</b> Click 2 points on map to measure distance.
          {measureDistance() !== null && (
            <span style={{ marginLeft: 12, fontWeight: 700, color: "var(--accent-hi)" }}>
              DISTANCE: {measureDistance()}{onGeo ? " km" : ` map units (~${(measureDistance()! * 0.25).toFixed(1)} km)`}
            </span>
          )}
        </div>
      )}

      <div className="tac-body">
        <MapContainer
          crs={onGeo ? undefined : L.CRS.Simple}
          bounds={onGeo ? windowBounds(geo!) : BOUNDS}
          style={{ height, background: MAP.bg }}
          attributionControl={false}
        >
          <MapMouseTracker
            onMouseMove={(lat, lng) => setCursorPos([lat, lng])}
            onClick={handleMapClick}
          />

          {onGeo && (
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={15}
              eventHandlers={{ tileerror: () => setTilesOffline(true) }}
            />
          )}

          {gridLines().map((l, i) => (
            <Polyline key={i} positions={l.map(([x, y]) => P(x, y))} pathOptions={{ color: MAP.grid, weight: 1 }} interactive={false} />
          ))}

          {/* Obstacles */}
          {obstacles.map((o) => (
            <Rectangle
              key={o.id}
              bounds={[P(o.x1, o.y1), P(o.x2, o.y2)]}
              pathOptions={{ color: obstacleColor(o.kind), weight: 1.5, dashArray: "4 3", fillOpacity: 0.18 }}
            >
              <Tooltip sticky>
                <div style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                  <b>{o.label ?? o.id}</b> · {o.kind.toUpperCase()}
                </div>
              </Tooltip>
            </Rectangle>
          ))}

          {/* Measure line */}
          {measurePoints.length === 2 && (
            <Polyline positions={measurePoints} pathOptions={{ color: "var(--danger)", weight: 2, dashArray: "5 5" }} />
          )}

          {/* Assets / Sites */}
          {showAssets && assets.map((a) =>
            a.x !== undefined && a.y !== undefined ? (
              <Rectangle
                key={a.id}
                bounds={[P(a.x - 4, a.y - 4), P(a.x + 4, a.y + 4)]}
                pathOptions={{
                  color: assetColor(a.status),
                  weight: selectedEntity?.id === a.id ? 3 : 1.8,
                  fillOpacity: selectedEntity?.id === a.id ? 0.45 : 0.25,
                }}
                eventHandlers={{
                  click: () => {
                    setSelectedEntity(a);
                    sound.playClick();
                  },
                }}
              >
                <Tooltip sticky>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                    <b>{a.id.toUpperCase()}</b> · {a.kind} · <span style={{ color: assetColor(a.status) }}>{a.status.toUpperCase()}</span>
                  </div>
                </Tooltip>
              </Rectangle>
            ) : null,
          )}

          {/* Units */}
          {showUnits && units.map((u) => {
            const conf = u.confidence ?? 1;
            const uncertaintyRadius = Math.max(0, (1 - conf) * 16);

            return (
              <span key={u.id}>
                {/* Range Rings */}
                {showRings && (
                  <>
                    <Circle center={P(u.x, u.y)} radius={15 * unitM} pathOptions={{ color: MAP.blue, weight: 1, dashArray: "3 4", fillOpacity: 0.04 }} />
                    <Circle center={P(u.x, u.y)} radius={30 * unitM} pathOptions={{ color: MAP.blue, weight: 1, dashArray: "6 6", fillOpacity: 0.02 }} />
                  </>
                )}

                {/* Fog of War / Uncertainty Ellipse */}
                {showFog && uncertaintyRadius > 1 && (
                  <Circle
                    center={P(u.x, u.y)}
                    radius={uncertaintyRadius * unitM}
                    pathOptions={{ color: MAP.warn, weight: 1, dashArray: "4 4", fillOpacity: 0.15, fillColor: MAP.warn }}
                  />
                )}

                {/* Waypoint Track Line */}
                {u.wp && u.wp.length > 0 && (
                  <Polyline
                    positions={[P(u.x, u.y), ...u.wp.map(([x, y]) => P(x, y))]}
                    pathOptions={{ color: MAP.blue, weight: 2, dashArray: "4 4" }}
                  />
                )}

                <MilMarker
                  sidc={u.sidc || (u.side === "opfor" ? "SHGPUCI----D---" : "SFGPUCI----D---")}
                  label={u.id.toUpperCase()}
                  position={P(u.x, u.y)}
                  sublabel={`${u.status} · conf ${Math.round((u.confidence ?? 1) * 100)}%`}
                  hot={hot.includes(u.id)}
                  confidence={u.confidence ?? 1}
                  onClick={() => {
                    setSelectedEntity(u);
                    sound.playClick();
                  }}
                />
              </span>
            );
          })}
        </MapContainer>
      </div>

      {/* Selected Entity Tactical Dossier Drawer */}
      {selectedEntity && (
        <div style={{
          background: "linear-gradient(180deg, #faf7f0, #efe9dd)",
          padding: "10px 14px",
          borderTop: "1px solid var(--line-hi)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          fontSize: 12,
          fontFamily: "var(--mono)",
        }}>
          <div>
            <span style={{ color: "var(--muted)" }}>SELECTED:</span>{" "}
            <b style={{ color: "var(--accent-hi)", fontSize: 13 }}>{selectedEntity.id.toUpperCase()}</b>
            {" · "}
            <span>{selectedEntity.type || selectedEntity.kind || "UNIT"}</span>
            {" · "}
            <span>STATUS: <b>{selectedEntity.status?.toUpperCase()}</b></span>
            {" · "}
            <span>GRID: [{Math.round(selectedEntity.x ?? 0)}, {Math.round(selectedEntity.y ?? 0)}]</span>
            {onGeo && selectedEntity.x !== undefined && selectedEntity.y !== undefined && (
              <span> · {fmtLat(P(selectedEntity.x, selectedEntity.y)[0])} {fmtLon(P(selectedEntity.x, selectedEntity.y)[1])}</span>
            )}
            {selectedEntity.confidence !== undefined && (
              <span> · CONFIDENCE: <b>{Math.round(selectedEntity.confidence * 100)}%</b></span>
            )}
          </div>
          <button
            className="btn ghost"
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => setSelectedEntity(null)}
          >
            ✕ CLOSE
          </button>
        </div>
      )}
    </div>
  );
}
