import { Suspense, lazy, useState } from "react";
import { MapView } from "../views/MapView";
import type { GeoWindow } from "./geo";

const CesiumView = lazy(() => import("./CesiumView").then((m) => ({ default: m.CesiumView })));

/** 2D tactical / 3D globe tabs + shared layer toggles. */
export function MapPanel(props: {
  units: any[]; assets: any[]; obstacles?: any[]; hot?: string[]; links?: any[]; height?: number;
  geo?: GeoWindow | null;
}) {
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [showUnits, setShowUnits] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  return (
    <div>
      <div className="map-tabs">
        <button className={mode === "2d" ? "sel" : ""} onClick={() => setMode("2d")}>2D TACTICAL</button>
        <button className={mode === "3d" ? "sel" : ""} onClick={() => setMode("3d")}>3D GLOBE</button>
        <span className="layers">
          <label><input type="checkbox" checked={showUnits} onChange={() => setShowUnits((v) => !v)} /> UNITS</label>
          <label><input type="checkbox" checked={showAssets} onChange={() => setShowAssets((v) => !v)} /> SITES</label>
        </span>
      </div>
      {mode === "2d" ? (
        <MapView
          units={props.units} assets={props.assets}
          obstacles={props.obstacles ?? []} hot={props.hot ?? []} links={props.links ?? []}
          showUnits={showUnits} showAssets={showAssets} height={props.height}
          geo={props.geo ?? null}
        />
      ) : (
        <Suspense fallback={<div className="panel"><span className="muted">Loading 3D globe…</span></div>}>
          <CesiumView
            units={props.units} assets={props.assets} obstacles={props.obstacles ?? []}
            hot={props.hot ?? []} links={props.links ?? []}
            showUnits={showUnits} showAssets={showAssets} height={props.height}
            geo={props.geo ?? null}
          />
        </Suspense>
      )}
    </div>
  );
}
