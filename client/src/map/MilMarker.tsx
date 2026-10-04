import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import ms from "milsymbol";
import { MAP } from "./palette";

interface Props {
  sidc: string;
  label: string;
  position: [number, number]; // [y, x] in CRS.Simple map units
  sublabel?: string;
  hot?: boolean; // recently reported — amber pulse ring
  confidence?: number;
  onClick?: () => void;
}

// Module-level icon cache
const iconCache = new Map<string, L.DivIcon>();

function markerIcon(sidc: string, label: string, hot: boolean, confidence: number = 1): L.DivIcon {
  const isDegraded = confidence < 0.7;
  const key = `${sidc}|${label}|${hot ? 1 : 0}|${isDegraded ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    let svg: string;
    try {
      svg = new ms.Symbol(sidc, {
        size: 32,
        uniqueDesignation: label,
        monoColor: isDegraded ? "#8a6d3b" : undefined,
      }).asSVG();
    } catch {
      svg = `<div style="width:24px;height:24px;background:${MAP.bad};transform:rotate(45deg);border:2px solid ${MAP.unknown}"></div>`;
    }

    const html = hot
      ? `<div class="pulse-wrap">${svg}<span class="pulse-ring"></span></div>`
      : isDegraded
        ? `<div style="opacity:0.8;filter:contrast(0.85);">${svg}</div>`
        : svg;

    icon = L.divIcon({
      html,
      className: "milsym",
      iconSize: hot ? [44, 44] : [32, 32],
      iconAnchor: hot ? [22, 22] : [16, 16],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function MilMarker({ sidc, label, position, sublabel, hot = false, confidence = 1, onClick }: Props) {
  return (
    <Marker
      position={position}
      icon={markerIcon(sidc, label, hot, confidence)}
      eventHandlers={{
        click: () => {
          if (onClick) onClick();
        },
      }}
    >
      <Popup>
        <div style={{ fontFamily: "var(--mono)", minWidth: 140 }}>
          <b style={{ color: "var(--accent-hi)", fontSize: 13 }}>{label}</b>
          {sublabel && <div style={{ fontSize: 11, margin: "3px 0" }}>{sublabel}</div>}
          <div style={{ fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: 3 }}>
            GRID: [{Math.round(position[1])}, {Math.round(position[0])}]
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
