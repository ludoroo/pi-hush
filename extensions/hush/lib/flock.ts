import { renderHushBrailleRows, type HushBraillePixel } from "./braille.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
  type HushAnimationRenderContext,
} from "./animation.ts";

export const HUSH_FLOCK_TICK_MS = 100;
export const HUSH_FLOCK_MIN_WIDTH = 10;
export const HUSH_FLOCK_MAX_WIDTH = 50;
export const HUSH_FLOCK_MULTI_ROW_MIN_WIDTH = 12;

const TAU = Math.PI * 2;
const GROUP_SPACING = 70; // Braille dots, independent of the viewport width.
const FLIGHT_SPEED = 6; // Dots per second, always left to right.
type Point = readonly [x: number, y: number];
type Bird = {
  readonly behind: number;
  readonly lane: number;
  readonly phase: number;
  readonly color: HushAnimationColor;
};
const FORMATION: readonly Bird[] = [
  { behind: 30, lane: -0.5, phase: 2.5, color: "muted" },
  { behind: 20, lane: 0.5, phase: 4.3, color: "tertiary" },
  { behind: 10, lane: -0.5, phase: 0.9, color: "secondary" },
  { behind: 0, lane: 0, phase: 0, color: "accent" },
];
// A viewport spanning the gap between formations always contains a breast dot,
// even when the wing tips are edge-on. Smaller canvases use the compact bird.
const MIN_FLIGHT_WIDTH = Math.max(
  HUSH_FLOCK_MIN_WIDTH,
  Math.ceil((GROUP_SPACING - Math.max(...FORMATION.map(({ behind }) => behind))) / 2),
);

/** An ongoing stream of formations: birds exit right and new birds enter left. */
export function renderHushFlock(
  context: HushAnimationRenderContext,
): HushAnimationFrame {
  const width = Math.max(1, Math.floor(context.width));
  const height =
    width < HUSH_FLOCK_MULTI_ROW_MIN_WIDTH
      ? 1
      : Math.max(1, Math.min(2, Math.floor(context.height)));
  const pixelWidth = width * 2;
  const pixelHeight = height * 4;
  const pixels: HushBraillePixel[] = Array.from(
    { length: pixelWidth * pixelHeight },
    () => undefined,
  );
  const put = (x: number, y: number, color: HushAnimationColor): void => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px >= 0 && px < pixelWidth && py >= 0 && py < pixelHeight) {
      pixels[py * pixelWidth + px] = color;
    }
  };
  const curve = (
    from: Point,
    control: Point,
    to: Point,
    color: HushAnimationColor,
  ): void => {
    for (let step = 0; step <= 12; step += 1) {
      const t = step / 12;
      const inverse = 1 - t;
      put(
        inverse * inverse * from[0] + 2 * inverse * t * control[0] + t * t * to[0],
        inverse * inverse * from[1] + 2 * inverse * t * control[1] + t * t * to[1],
        color,
      );
    }
  };
  const wingClock = (context.elapsedMs / 1_400) * TAU;
  const drawBird = (
    x: number,
    y: number,
    bird: Bird,
    group: number,
    scale = 1,
  ): void => {
    const lift =
      Math.sin(wingClock + bird.phase + group * 1.3) * (height === 1 ? 0.85 : 2.3);
    const point = (dx: number, dy: number): Point => [x + dx * scale, y + dy];
    // Joined wing strokes read cleanly at this scale. Separate head/body dots
    // can look like stray speckles beneath the raised wings.
    curve(
      point(0, 0), point(-1.1, lift * 0.7), point(-3.5, lift), bird.color,
    );
    curve(
      point(0, 0), point(0.9, lift * 0.35), point(2.5, lift * 0.82), bird.color,
    );
    if (bird.behind === 0) put(...point(0, 0), "highlight");
  };

  if (width < MIN_FLIGHT_WIDTH) {
    // Too little runway for a formation: retain a visible, flapping silhouette.
    drawBird(
      (pixelWidth - 1) / 2,
      Math.round((pixelHeight - 1) / 2),
      FORMATION.at(-1)!,
      0,
      Math.min(1, (pixelWidth - 1) / 7),
    );
  } else {
    const distance = 20 + (context.elapsedMs / 1_000) * FLIGHT_SPEED;
    // Enumerate only formations intersecting the viewport. The same group ID
    // keeps its wing phases across resizes and entry/exit; no on-screen wrap.
    const firstGroup = Math.ceil((distance - pixelWidth - 34) / GROUP_SPACING);
    const lastGroup = Math.floor((distance + 4) / GROUP_SPACING);
    for (let group = firstGroup; group <= lastGroup; group += 1) {
      const leadX = distance - group * GROUP_SPACING;
      for (const bird of FORMATION) {
        const x = leadX - bird.behind;
        if (x < -4 || x > pixelWidth + 4) continue;
        // Anchor the breast to a dot row so level wings cannot straddle rows
        // and leave apparent speckles underneath the silhouette.
        const y = Math.round((pixelHeight - 1) / 2 + (height === 1 ? 0 : bird.lane));
        drawBird(x, y, bird, group);
      }
    }
  }

  const rows = renderHushBrailleRows(pixels, width, height);
  return rows.length === 1 ? rows[0]! : { rows };
}

export const HUSH_FLOCK_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "flock",
  label: "Flock",
  description: "Fine-dot birds in formation, steadily migrating left to right",
  intervalMs: HUSH_FLOCK_TICK_MS,
  width: {
    ratio: 0.65,
    minColumns: HUSH_FLOCK_MIN_WIDTH,
    maxColumns: HUSH_FLOCK_MAX_WIDTH,
  },
  maxHeight: 2,
  minWidthForMultiRow: HUSH_FLOCK_MULTI_ROW_MIN_WIDTH,
  placement: "aboveEditor",
  renderFrame: renderHushFlock,
});
