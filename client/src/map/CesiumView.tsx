// 3D globe view (lazy chunk — Cesium only loads when the 3D tab opens).
// Fictional 200x200 grid mapped around coordinates (0,0) in warm tactical cream styling.
import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import ms from "milsymbol";
import { MAP, assetColor, obstacleColor } from "./palette";
import { summarizeLinks, type LinkSum } from "./linkHealth";
import type { GeoWindow } from "./geo";
import { sound } from "../sound";

interface Unit {
  id: string; side: string; type: string;
  x: number; y: number; status: string; sidc?: string; confidence?: number;
}
interface Asset {
  id: string; kind: string; status: string; x?: number; y?: number;
}
interface Obstacle {
  id: string; kind: string; x1: number; y1: number; x2: number; y2: number; label?: string;
}

const symCache = new Map<string, HTMLCanvasElement>();
function symCanvas(sidc: string, label: string): HTMLCanvasElement {
  const key = `${sidc}|${label}`;
  let c = symCache.get(key);
  if (!c) {
    try {
      c = new ms.Symbol(sidc, { size: 64, uniqueDesignation: label }).asCanvas() as unknown as HTMLCanvasElement;
    } catch {
      c = document.createElement("canvas");
    }
    symCache.set(key, c);
  }
  return c;
}

const sidcFor = (u: Unit) =>
  u.sidc || (u.side === "opfor" ? "SHGPUCI----D---" : "SFGPUCI----D---");

export function CesiumView({
  units, assets, obstacles = [], hot = [], links = [],
  showUnits = true, showAssets = true, showLabels = true, height = 440, geo = null,
}: {
  units: Unit[]; assets: Asset[]; obstacles?: Obstacle[]; hot?: string[]; links?: LinkSum[];
  showUnits?: boolean; showAssets?: boolean; showLabels?: boolean; height?: number;
  geo?: GeoWindow | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [error, setError] = useState("");
  const [camPreset, setCamPreset] = useState<"top" | "iso" | "close">("iso");
  // Same rules as the 2D map — a blackout must be visible in 3D too.
  const { blackout, degraded } = summarizeLinks(links);

  // Grid → degrees: real window when the deck declares one, else the classic ±1.5° patch.
  const gx = (x: number) => (geo ? geo.origin.lon + (x / 200) * geo.span.lon : ((x - 100) / 100) * 1.5);
  const gy = (y: number) => (geo ? geo.origin.lat + (y / 200) * geo.span.lat : ((y - 100) / 100) * 1.5);
  const spanDeg = geo ? geo.span.lat : 4.4;
  const spanM = spanDeg * 111320;
  const centerLon = geo ? geo.origin.lon + geo.span.lon / 2 : 0;
  const southLat = geo ? geo.origin.lat : -2.2;

  useEffect(() => {
    if (!ref.current || viewerRef.current) return;
    try {
      const base = geo
        ? new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              maximumLevel: 15,
              credit: "© OpenStreetMap contributors",
            }),
          )
        : new Cesium.ImageryLayer(
            new Cesium.GridImageryProvider({
              cells: 8,
              color: Cesium.Color.fromCssColorString("rgba(135,120,95,0.3)"),
              backgroundColor: Cesium.Color.fromCssColorString(MAP.bg),
            }),
          );
      const viewer = new Cesium.Viewer(ref.current, {
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false,
        baseLayer: base,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      });

      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(MAP.bg);
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#e4ded2");
      viewer.camera.setView({
        destination: geo
          ? Cesium.Rectangle.fromDegrees(geo.origin.lon, geo.origin.lat, geo.origin.lon + geo.span.lon, geo.origin.lat + geo.span.lat)
          : Cesium.Rectangle.fromDegrees(-2.2, -2.2, 2.2, 2.2),
        orientation: { heading: 0, pitch: -0.85, roll: 0 },
      });

      const credit = viewer.cesiumWidget.creditContainer as HTMLElement;
      // Real terrain must carry the OSM attribution; the synthetic grid needs none.
      if (credit && !geo) credit.style.display = "none";
      viewerRef.current = viewer;
    } catch (e) {
      setError(`3D globe initialization notice (${(e as Error).message}) — 2D tactical map remains fully operational.`);
    }
    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [geo]);

  const setCameraView = (preset: "top" | "iso" | "close") => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    sound.playClick();
    setCamPreset(preset);

    if (preset === "top") {
      viewer.camera.flyTo({
        destination: geo
          ? Cesium.Rectangle.fromDegrees(geo.origin.lon + geo.span.lon * 0.045, geo.origin.lat + geo.span.lat * 0.045, geo.origin.lon + geo.span.lon * 0.955, geo.origin.lat + geo.span.lat * 0.955)
          : Cesium.Rectangle.fromDegrees(-2.0, -2.0, 2.0, 2.0),
        orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
        duration: 1.2,
      });
    } else if (preset === "iso") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, southLat, geo ? Math.round(spanM * 0.92) : 450000),
        orientation: { heading: 0, pitch: -0.85, roll: 0 },
        duration: 1.2,
      });
    } else if (preset === "close") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, southLat + spanDeg * 0.25, geo ? Math.round(spanM * 0.45) : 220000),
        orientation: { heading: 0.2, pitch: -0.65, roll: 0 },
        duration: 1.2,
      });
    }
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.removeAll();

    // 3D Obstacles
    for (const o of obstacles) {
      viewer.entities.add({
        id: `o-${o.id}`,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(gx(o.x1), gy(o.y1), gx(o.x2), gy(o.y2)),
          material: Cesium.Color.fromCssColorString(obstacleColor(o.kind)).withAlpha(0.28),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(obstacleColor(o.kind)),
          extrudedHeight: o.kind === "hills" ? 2500 : 800,
        },
        label: showLabels && o.label ? {
          text: o.label.toUpperCase(),
          font: "10px IBM Plex Mono, monospace",
          fillColor: Cesium.Color.fromCssColorString("#1a2026"),
          backgroundColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.7)"),
          showBackground: true,
          pixelOffset: new Cesium.Cartesian2(0, -14),
        } : undefined,
      });
    }

    // 3D Assets
    if (showAssets) {
      for (const a of assets) {
        if (a.x === undefined || a.y === undefined) continue;
        const col = Cesium.Color.fromCssColorString(assetColor(a.status));
        viewer.entities.add({
          id: `a-${a.id}`,
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(gx(a.x - 3), gy(a.y - 3), gx(a.x + 3), gy(a.y + 3)),
            material: col.withAlpha(0.35),
            outline: true,
            outlineColor: col,
            extrudedHeight: 1200,
          },
          label: showLabels ? {
            text: `${a.id.toUpperCase()} [${a.status.toUpperCase()}]`,
            font: "10px IBM Plex Mono, monospace",
            fillColor: Cesium.Color.fromCssColorString("#0f1418"),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.85)"),
            showBackground: true,
            pixelOffset: new Cesium.Cartesian2(0, -16),
          } : undefined,
        });
      }
    }

    // 3D Units
    if (showUnits) {
      for (const u of units) {
        const isHot = hot.includes(u.id);
        const height = 1500;

        // Leader line to terrain
        viewer.entities.add({
          id: `line-${u.id}`,
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(gx(u.x), gy(u.y), 0),
              Cesium.Cartesian3.fromDegrees(gx(u.x), gy(u.y), height),
            ],
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString("rgba(135,120,95,0.6)"),
            }),
          },
        });

        viewer.entities.add({
          id: `u-${u.id}`,
          position: Cesium.Cartesian3.fromDegrees(gx(u.x), gy(u.y), height),
          billboard: {
            image: symCanvas(sidcFor(u), u.id.toUpperCase()),
            scale: 0.55,
            color: isHot ? Cesium.Color.fromCssColorString(MAP.warn) : Cesium.Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: showLabels ? {
            text: `${u.id.toUpperCase()} · ${u.status}`,
            font: "11px IBM Plex Mono, monospace",
            fillColor: Cesium.Color.fromCssColorString("#0f1418"),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.85)"),
            showBackground: true,
            pixelOffset: new Cesium.Cartesian2(0, -36),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          } : undefined,
        });
      }
    }
  }, [units, assets, obstacles, hot, showUnits, showAssets, showLabels, geo]);

  if (error) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <span className="muted">{error}</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {blackout && <div className="tac-banner">RF INTERFERENCE // COMMS BLACKOUT ACTIVE</div>}
      {!blackout && degraded && <div className="tac-banner">NETS DEGRADED // EXPECT DELAYED OR PARTIAL PICTURES</div>}
      <div style={{
        position: "absolute", top: 10, right: 10, zIndex: 10,
        display: "flex", gap: 5, background: "rgba(243,239,230,0.9)",
        padding: 4, borderRadius: 6, border: "1px solid var(--line-hi)",
        boxShadow: "var(--neu-sm)",
      }}>
        <button
          className={`btn ghost ${camPreset === "top" ? "primary" : ""}`}
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() => setCameraView("top")}
        >
          2D NADIR
        </button>
        <button
          className={`btn ghost ${camPreset === "iso" ? "primary" : ""}`}
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() => setCameraView("iso")}
        >
          3D THEATER
        </button>
        <button
          className={`btn ghost ${camPreset === "close" ? "primary" : ""}`}
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() => setCameraView("close")}
        >
          LOW OBLIQUE
        </button>
      </div>
      <div ref={ref} style={{ height, overflow: "hidden", borderRadius: 10, border: "1px solid var(--line-hi)", boxShadow: "var(--neu-inset)" }} />
    </div>
  );
}
