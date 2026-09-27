import {
  composeHushAnimationCells,
  type HushAnimationCell,
} from "./animation-cells.ts";
import { renderHushBrailleRows, type HushBraillePixel } from "./braille.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
  type HushAnimationRenderContext,
} from "./animation.ts";

export const HUSH_SHOOTING_STAR_TICK_MS = 80;
export const HUSH_SHOOTING_STAR_TAIL_LENGTH = 3;
export const HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH = 12;

// A fuller, neutral-width text star: more ink without an emoji's double width.
const STAR_GLYPH = "✸";
type ShootingStarContext = HushAnimationFrameContext &
  Partial<Pick<HushAnimationRenderContext, "height" | "elapsedMs">>;

/** A shimmering meteor on a clear canvas, falling gently in taller panes. */
export function renderHushShootingStar(
  context: ShootingStarContext,
): HushAnimationFrame {
  const width = Number.isFinite(context.width) ? Math.max(1, Math.floor(context.width)) : 1;
  const requestedHeight = context.height ?? 1;
  const height = width < HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH || !Number.isFinite(requestedHeight)
    ? 1 : Math.max(1, Math.min(2, Math.floor(requestedHeight)));
  const elapsedMs = context.elapsedMs ?? context.frame * HUSH_SHOOTING_STAR_TICK_MS;
  const frame = Number.isFinite(elapsedMs) ? Math.floor(elapsedMs / HUSH_SHOOTING_STAR_TICK_MS) : 0;
  const cycle = width + HUSH_SHOOTING_STAR_TAIL_LENGTH;
  const head = ((frame % cycle) + cycle) % cycle;
  const flicker = Math.floor(frame / 2);
  const pixelWidth = width * 2;
  const pixels: HushBraillePixel[] = Array.from({ length: pixelWidth * height * 4 }, () => undefined);
  const starRow = (column: number): number => {
    const progress = Math.max(0, Math.min(1, column / Math.max(1, width - 1)));
    return Math.round((height - 1) * progress * progress);
  };
  const put = (x: number, y: number, color: HushBraillePixel): void => {
    const py = Math.round(y);
    if (x >= 0 && x < pixelWidth && py >= 0 && py < height * 4) pixels[py * pixelWidth + x] = color;
  };

  // Stagger density changes through the wake. Every tail cell retains a spark,
  // including the last one after the head exits; there is no blank reset frame.
  for (let distance = 1; distance <= HUSH_SHOOTING_STAR_TAIL_LENGTH; distance += 1) {
    const column = head - distance;
    if (column < 0 || column >= width) continue;
    const x = column * 2;
    // Smooth actual glyph positions, not the unsnapped curve. Even the newest
    // sample is at or behind the head, so the wake follows rather than leads it.
    const y = 1.5 + (4 / 3) *
      (starRow(column - 1) + starRow(column) + starRow(column + 1));
    const pulse = ((flicker + distance) % 4 + 4) % 4;
    if (distance === 1) {
      put(x, y - 0.5, "accent");
      put(x + 1, y + 0.5, "accent");
      if (pulse !== 1) put(x + 1, y - 0.5, "accent");
      if (pulse !== 3) put(x, y + 0.5, "accent");
    } else if (distance === 2) {
      put(x, y + (pulse % 2 ? 0.5 : -0.5), "secondary");
      if (pulse !== 2) put(x + 1, y - 0.5, "secondary");
    } else {
      put(x + (pulse === 2 ? 1 : 0), y + (pulse < 2 ? -0.5 : 0.5), "muted");
    }
  }

  const cells: HushAnimationCell[][] = renderHushBrailleRows(pixels, width, height)
    .map((row) => ("segments" in row ? row.segments : [row]).flatMap((segment) =>
      Array.from(segment.text, (text) => ({ text, color: segment.color ?? "accent" })),
    ));
  if (head < width) {
    // The star stays a crisp text glyph; its dot-grid wake bridges the row change.
    const row = starRow(head);
    cells[row]![head] = { text: STAR_GLYPH, color: "highlight" };
  }
  const rows = cells.map(composeHushAnimationCells);
  return rows.length === 1 ? rows[0]! : { rows };
}

export const HUSH_SHOOTING_STAR_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "shooting-star",
  label: "Shooting star",
  description: "A bright falling star with a softly shimmering tail",
  intervalMs: HUSH_SHOOTING_STAR_TICK_MS,
  width: { ratio: 1 },
  maxHeight: 2,
  minWidthForMultiRow: HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH,
  placement: "aboveEditor",
  renderFrame: renderHushShootingStar,
});
