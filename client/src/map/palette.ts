// Institutional map palette — single source of truth for map drawing.
// Hex constants because Leaflet/Cesium paint via SVG/canvas APIs.
// Tactical command cream / topographic charting tones.

export const MAP = {
  bg: "#ede8df",
  grid: "rgba(100, 90, 75, 0.16)",
  water: "#367499",
  hill: "#9c7942",
  destroyed: "#b33948",
  unknown: "#827e74",
  ok: "#2e7d32",
  warn: "#b87018",
  bad: "#c23847",
  blue: "#1e5b8a",
  opfor: "#a83232",
  neutral: "#5c6b73",
} as const;

export const assetColor = (status: string) =>
  status === "open" ? MAP.ok
    : status === "closed" ? MAP.bad
      : status === "occupied" ? MAP.warn
        : status === "destroyed" ? MAP.destroyed : MAP.unknown;

export const obstacleColor = (kind: string) =>
  kind === "water" ? MAP.water
    : kind === "hills" ? MAP.hill
      : kind === "minefield" ? MAP.bad
        : MAP.unknown;
