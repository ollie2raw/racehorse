/**
 * Layout generator for the Journey trail map (design handoff:
 * design_handoff_journey_page/README.md). Nodes alternate x = 18% / 82%,
 * with the final node in the chapter centered at 50%; y is spaced a fixed
 * 168px apart starting 90px from the top of the map. The path between nodes
 * is a smooth vertical S-curve through each pair's midpoint Y.
 */

export type TrailPoint = { x: number; y: number };

export type JourneyTrailLayout = {
  /** x in 0–100 (%) for positioning node elements against the map's width. */
  positions: TrailPoint[];
  /** SVG path in the map's viewBox coordinate space (see VIEWBOX_WIDTH). */
  pathD: string;
  containerHeight: number;
  viewBoxWidth: number;
};

const TOP = 90;
const SPACING = 168;
const X_LEFT = 18;
const X_RIGHT = 82;
const X_CENTER = 50;

/**
 * The map's viewBox width matches its CSS max-width (900px) rather than a
 * plain 0–100. A 0–100 viewBox stretched across an ~900px-wide container
 * gives the path a ~9x horizontal scale against a 1x vertical scale (since
 * the SVG's height is a fixed px value matching containerHeight) — enough
 * of a non-uniform stretch that stroke-width and stroke-dasharray render
 * badly distorted (thick, pill-shaped dashes). Matching the viewBox width to
 * the real max-width keeps the two axes at parity on any desktop-width
 * viewport, where the map actually renders at its full 900px.
 */
const VIEWBOX_WIDTH = 900;

export function buildJourneyTrailLayout(nodeCount: number): JourneyTrailLayout {
  if (nodeCount <= 0) {
    return { positions: [], pathD: '', containerHeight: TOP + TOP, viewBoxWidth: VIEWBOX_WIDTH };
  }

  const positions: TrailPoint[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const x = i === nodeCount - 1 ? X_CENTER : i % 2 === 0 ? X_LEFT : X_RIGHT;
    const y = TOP + i * SPACING;
    positions.push({ x, y });
  }

  const pathPoints = positions.map((p) => ({ x: (p.x / 100) * VIEWBOX_WIDTH, y: p.y }));

  let pathD = `M ${pathPoints[0].x} ${pathPoints[0].y}`;
  for (let i = 1; i < pathPoints.length; i += 1) {
    const p0 = pathPoints[i - 1];
    const p1 = pathPoints[i];
    const midY = (p0.y + p1.y) / 2;
    pathD += ` C ${p0.x} ${midY}, ${p1.x} ${midY}, ${p1.x} ${p1.y}`;
  }

  const containerHeight = TOP + Math.max(0, nodeCount - 1) * SPACING + TOP;

  return { positions, pathD, containerHeight, viewBoxWidth: VIEWBOX_WIDTH };
}
