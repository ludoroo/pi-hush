import { renderHushBrailleRows, type HushBraillePixel as Pixel } from "../lib/braille.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
  type HushAnimationRenderContext,
} from "../lib/animation.ts";

export const HUSH_FISH_LOOP_TICK_MS = 100;
export const HUSH_FISH_LOOP_DURATION_MS = 7_200;
export const HUSH_FISH_LOOP_MIN_WIDTH = 12;
export const HUSH_FISH_LOOP_MAX_WIDTH = 48;
export const HUSH_FISH_LOOP_MULTI_ROW_MIN_WIDTH = 16;

const TAU = Math.PI * 2;
type Point = readonly [x: number, y: number];

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function pointInTriangle(
  x: number,
  y: number,
  [ax, ay]: Point,
  [bx, by]: Point,
  [cx, cy]: Point,
): boolean {
  const ab = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const bc = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const ca = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  return (ab <= 0 && bc <= 0 && ca <= 0) || (ab >= 0 && bc >= 0 && ca >= 0);
}

/**
 * Draw a fish into a 2x4-dot-per-cell canvas. The horizontal silhouette
 * compresses at each end of the swim so its change of direction reads as a
 * turn, rather than a sprite abruptly flipping in place.
 */
function drawFish(
  width: number,
  height: number,
  elapsedMs: number,
): readonly Pixel[] {
  const pixelWidth = width * 2;
  const pixelHeight = height * 4;
  const pixels: Pixel[] = Array.from(
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

  const loopProgress =
    positiveModulo(elapsedMs, HUSH_FISH_LOOP_DURATION_MS) /
    HUSH_FISH_LOOP_DURATION_MS;
  const angle = loopProgress * TAU;
  const swimVelocity = Math.sin(angle);
  const direction = swimVelocity >= 0 ? 1 : -1;
  const turnProfile = 0.1 + Math.abs(swimVelocity) * 0.9;

  const maximumBodyRadius = height === 1 ? 5 : height === 2 ? 6 : 8;
  // Two body+tail margins consume 3.6 radii plus two pixels. Leave at
  // least 40% of the canvas for travel, especially at the multi-row threshold.
  const travelLimitedRadius = (pixelWidth * 0.6 - 2) / 3.6;
  const bodyRadiusX = Math.max(
    0.7,
    Math.min(maximumBodyRadius, travelLimitedRadius),
  );
  const bodyRadiusY = Math.max(1, height * 1.05);
  const tailLength = Math.max(1, bodyRadiusX * 0.8);
  const fullExtent = bodyRadiusX + tailLength;
  const left = Math.min(fullExtent + 0.5, (pixelWidth - 1) / 2);
  const right = Math.max(left, pixelWidth - 1 - fullExtent - 0.5);
  const travel = (1 - Math.cos(angle)) / 2;
  const centerX = left + (right - left) * travel;
  const bob = Math.sin(angle * 2 + 0.35) * Math.min(0.55, height * 0.2);
  const centerY = (pixelHeight - 1) / 2 + bob;
  const projectedRadiusX = Math.max(0.55, bodyRadiusX * turnProfile);
  // Keep the established swim envelope, but give the tail a smaller silhouette.
  const projectedTailLength = Math.max(0.35, tailLength * turnProfile * 0.75);
  const tailBeat = Math.sin(angle * 13) * bodyRadiusY * 0.32;

  // A small deterministic wake makes the water feel alive without becoming
  // visual noise. It fades naturally at turns as the trailing dots converge.
  if (Math.abs(swimVelocity) > 0.22) {
    for (let bubble = 0; bubble < 3; bubble += 1) {
      const age = positiveModulo(loopProgress * 72 + bubble * 3.1, 9);
      const bubbleX = centerX - direction * (fullExtent + 1.5 + age * 0.72);
      const bubbleY = centerY + Math.sin(age + bubble * 1.7) * bodyRadiusY;
      put(bubbleX, bubbleY, "muted");
    }
  }

  const toCanvas = (localX: number, localY: number): Point => [
    centerX + localX * direction,
    centerY + localY,
  ];

  // The forked tail is two tapered lobes with a shared, oscillating root.
  const tailRootX = -projectedRadiusX * 0.63;
  const tailTipX = -projectedRadiusX - projectedTailLength;
  const tailRoot = toCanvas(tailRootX, tailBeat * 0.12);
  const tailTip = toCanvas(tailTipX, tailBeat);
  const upperTail = toCanvas(
    tailTipX + projectedTailLength * 0.08,
    tailBeat - bodyRadiusY * 0.95,
  );
  const lowerTail = toCanvas(
    tailTipX + projectedTailLength * 0.08,
    tailBeat + bodyRadiusY * 0.95,
  );
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      if (
        pointInTriangle(x, y, tailRoot, tailTip, upperTail) ||
        pointInTriangle(x, y, tailRoot, tailTip, lowerTail)
      ) {
        put(x, y, "secondary");
      }
    }
  }

  // Dorsal and ventral fins extend the silhouette beyond the smooth body.
  const dorsal: readonly [Point, Point, Point] = [
    toCanvas(-projectedRadiusX * 0.28, -bodyRadiusY * 0.72),
    toCanvas(projectedRadiusX * 0.18, -bodyRadiusY * 1.62),
    toCanvas(projectedRadiusX * 0.45, -bodyRadiusY * 0.68),
  ];
  const ventral: readonly [Point, Point, Point] = [
    toCanvas(-projectedRadiusX * 0.18, bodyRadiusY * 0.7),
    toCanvas(projectedRadiusX * 0.2, bodyRadiusY * 1.35),
    toCanvas(projectedRadiusX * 0.5, bodyRadiusY * 0.62),
  ];
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      if (
        pointInTriangle(x, y, ...dorsal) ||
        pointInTriangle(x, y, ...ventral)
      ) {
        put(x, y, "tertiary");
      }
    }
  }

  // Rounded body with a darker belly and sparse scale glints.
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const localX = (x - centerX) * direction;
      const localY = y - centerY;
      const ellipse =
        (localX * localX) / (projectedRadiusX * projectedRadiusX) +
        (localY * localY) / (bodyRadiusY * bodyRadiusY);
      if (ellipse > 1) continue;
      const isBelly = localY > bodyRadiusY * 0.18 && ellipse < 0.88;
      const isScaleGlint =
        ellipse < 0.7 &&
        localX < projectedRadiusX * 0.25 &&
        (Math.round(localX - localY) & 3) === 0;
      put(x, y, isScaleGlint ? "tertiary" : isBelly ? "secondary" : "accent");
    }
  }

  // A swept pectoral fin follows the tail beat at a gentler amplitude.
  const finLift = Math.sin(angle * 9) * bodyRadiusY * 0.25;
  const pectoral: readonly [Point, Point, Point] = [
    toCanvas(projectedRadiusX * 0.1, bodyRadiusY * 0.05),
    toCanvas(-projectedRadiusX * 0.35, bodyRadiusY * 0.65 + finLift),
    toCanvas(projectedRadiusX * 0.42, bodyRadiusY * 0.42),
  ];
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      if (pointInTriangle(x, y, ...pectoral)) put(x, y, "tertiary");
    }
  }

  // Hide the eye edge-on during a turn; it reappears on the new leading side.
  if (Math.abs(swimVelocity) > 0.16) {
    put(...toCanvas(projectedRadiusX * 0.57, -bodyRadiusY * 0.27), "highlight");
  }
  put(...toCanvas(projectedRadiusX * 0.94, bodyRadiusY * 0.13), "secondary");

  return pixels;
}

/** Render a responsive one-to-three-row, fixed-time fish swim cycle. */
export function renderHushFishLoop(
  context: HushAnimationRenderContext,
): HushAnimationFrame {
  const width = Math.max(1, Math.floor(context.width));
  const allocatedHeight = Math.max(1, Math.min(3, Math.floor(context.height)));
  const height =
    width < HUSH_FISH_LOOP_MULTI_ROW_MIN_WIDTH ? 1 : allocatedHeight;
  const rows = renderHushBrailleRows(
    drawFish(width, height, context.elapsedMs),
    width,
    height,
  );
  return rows.length === 1 ? rows[0]! : { rows };
}

export const HUSH_FISH_LOOP_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "fish-loop",
  label: "Fish Loop",
  description: "A fluid, shaded fish swimming and turning in a quiet loop",
  intervalMs: HUSH_FISH_LOOP_TICK_MS,
  width: {
    ratio: 1,
    minColumns: HUSH_FISH_LOOP_MIN_WIDTH,
    maxColumns: HUSH_FISH_LOOP_MAX_WIDTH,
  },
  maxHeight: 3,
  minWidthForMultiRow: HUSH_FISH_LOOP_MULTI_ROW_MIN_WIDTH,
  placement: "aboveEditor",
  renderFrame: renderHushFishLoop,
});
