import { buildChapter1TrailLayout } from './journeyChapter1Layout';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';

const JOURNEY_TRAIL_COLUMNS = 4;

export type TrailPoint = { x: number; y: number };

/** Per-index organic nudges for chapters with other node counts. */
const ORGANIC_X_NUDGE = [0, -2.5, 1.8, 2.2, 1.5, -1.2, 2, -2, -1.5, 1, -1.8, 2.4, 0.5, -2, 1.6, -1, 2.2, -1.4, 0.8, -2.2, 1.3, -0.8, 2, -1.6];
const ORGANIC_Y_NUDGE = [0, 1.2, -1.5, 0.8, 2, -0.6, 1.4, -1, 1.8, -0.8, 1.2, 2, -1, 0.6, -1.2, 1.5, -0.5, 1, -1.8, 0.4, -1, 1.6, -0.7, 1.1];
const ROW_Y_WAVE = [0, 1.5, -1.2, 2, -0.8, 1.8];

function getSnakeColumn(index: number, columns: number): number {
  const row = Math.floor(index / columns);
  const positionInRow = index % columns;
  return row % 2 === 0 ? positionInRow : columns - 1 - positionInRow;
}

function generateOrganicTrailPositions(
  nodeCount: number,
  columns = JOURNEY_TRAIL_COLUMNS,
  chapterId?: string,
): TrailPoint[] {
  if (chapterId === JOURNEY_CHAPTER_1_ID && nodeCount === 12 && columns === 4) {
    return buildChapter1TrailLayout().positions;
  }

  const rows = Math.ceil(nodeCount / columns);
  const xPad = 11;
  const xSpan = 73;
  const yPad = 10;
  const ySpan = rows > 1 ? Math.min(80, 14 + (rows - 1) * 13) : 0;

  const points: TrailPoint[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const row = Math.floor(i / columns);
    const col = getSnakeColumn(i, columns);
    const xBase = columns > 1 ? xPad + (col / (columns - 1)) * xSpan : 50;
    const yBase = rows > 1 ? yPad + (row / (rows - 1)) * ySpan : yPad + ySpan * 0.5;
    points.push({
      x: xBase + (ORGANIC_X_NUDGE[i % ORGANIC_X_NUDGE.length] ?? 0) + (ROW_Y_WAVE[row % ROW_Y_WAVE.length] ?? 0) * 0.15,
      y: yBase + (ORGANIC_Y_NUDGE[i % ORGANIC_Y_NUDGE.length] ?? 0) + (ROW_Y_WAVE[row % ROW_Y_WAVE.length] ?? 0),
    });
  }
  return points;
}

/** Smooth campaign trail via Catmull-Rom → cubic Bézier segments. */
function buildSmoothTrailPath(points: TrailPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

export type JourneyTrailLayout = {
  positions: TrailPoint[];
  pathD: string;
  viewBox: string;
  rowCount: number;
};

export function buildJourneyTrailLayout(
  nodeCount: number,
  chapterId?: string,
  columns = JOURNEY_TRAIL_COLUMNS,
): JourneyTrailLayout {
  if (chapterId === JOURNEY_CHAPTER_1_ID && nodeCount === 12 && columns === 4) {
    return buildChapter1TrailLayout();
  }

  const positions = generateOrganicTrailPositions(nodeCount, columns, chapterId);
  const rowCount = Math.ceil(nodeCount / columns);

  return {
    positions,
    pathD: buildSmoothTrailPath(positions),
    viewBox: '0 0 100 100',
    rowCount,
  };
}

/** @deprecated Use buildJourneyTrailLayout */
export function buildJourneyTrailPath(
  nodeCount: number,
  chapterId?: string,
  columns = JOURNEY_TRAIL_COLUMNS,
): {
  d: string;
  viewBox: string;
  height: number;
} {
  const layout = buildJourneyTrailLayout(nodeCount, chapterId, columns);
  return {
    d: layout.pathD,
    viewBox: layout.viewBox,
    height: 100,
  };
}

export function getJourneyTrailVisualProgress(
  nodes: ReadonlyArray<{ status: string }>,
): number {
  const count = nodes.length;
  if (count <= 1) return 0;

  const currentIdx = nodes.findIndex((node) => node.status === 'current');
  const lastCompletedIdx = nodes.reduce(
    (max, node, index) => (node.status === 'completed' ? index : max),
    -1,
  );
  const focalIdx = currentIdx >= 0 ? currentIdx : lastCompletedIdx;
  if (focalIdx < 0) return 0;

  const normalized = (focalIdx + 0.22) / (count - 1);
  return Math.min(100, Math.round(normalized * 100));
}

export function getJourneyTrailStepPosition(index: number, nodeCount: number): TrailPoint {
  const layout = buildJourneyTrailLayout(nodeCount);
  return layout.positions[index] ?? { x: 50, y: 50 };
}
