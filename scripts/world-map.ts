// Regenerates src/partials/world-dots.html: the dashboard's dotted world map, one dot per grid
// cell whose centre is on land in Natural Earth 1:110m (public domain), pinned to v5.1.2.
// Run: bun scripts/world-map.ts. The output is committed; the build never fetches it.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson";
const COLS = 120;
const NORTH = 78;
const SOUTH = -56;
const ROWS = Math.round((COLS * (NORTH - SOUTH)) / 360);

type Ring = [number, number][];
const geo = (await (await fetch(SOURCE)).json()) as { features: { geometry: { type: string; coordinates: unknown } }[] };
const polygons: Ring[][] = geo.features.flatMap(({ geometry }) =>
  geometry.type === "Polygon" ? [geometry.coordinates as Ring[]] : (geometry.coordinates as Ring[][]),
);

// Ray casting; holes (inner rings) flip the answer back.
const inside = (lon: number, lat: number) =>
  polygons.some((rings) =>
    rings.reduce((acc, ring, ringIndex) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return ringIndex === 0 ? hit : acc && !hit;
    }, false),
  );

const dots: string[] = [];
for (let row = 0; row < ROWS; row++) {
  const lat = NORTH - ((row + 0.5) * (NORTH - SOUTH)) / ROWS;
  for (let col = 0; col < COLS; col++) {
    const lon = -180 + ((col + 0.5) * 360) / COLS;
    if (inside(lon, lat)) dots.push(`M${col} ${row}h0`);
  }
}
await writeFile(
  join(import.meta.dir, "../src/partials/world-dots.html"),
  // The land path is drawn once and reused by the sweep layer; both take their stroke from CSS.
// The sweep is a second <svg> over the first so CSS can mask the whole layer.
  `<svg class="world" viewBox="-1 -1 ${COLS + 1} ${ROWS + 1}" aria-hidden="true" focusable="false"><path id="world-land" d="${dots.join("")}"/></svg>` +
    `<svg class="world world-sweep" viewBox="-1 -1 ${COLS + 1} ${ROWS + 1}" aria-hidden="true" focusable="false"><use href="#world-land"/></svg>\n`,
);
console.log(`world map: ${dots.length} land dots on a ${COLS}x${ROWS} grid`);
