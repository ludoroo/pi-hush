import {
  composeHushAnimationCells,
  type HushAnimationCell,
} from "./animation-cells.ts";
import { renderHushBrailleRows, type HushBraillePixel } from "./braille.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
  type HushAnimationRenderContext,
} from "./animation.ts";

export const HUSH_CAT_BALL_TICK_MS = 50;
export const HUSH_CAT_BALL_DURATION_MS = 14_000;
export const HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH = 18;

const PLAY_BEATS = [
  { start: 5_050, contact: 5_700, end: 6_450, distance: 2.5, hop: 2.2 },
  { start: 6_850, contact: 7_500, end: 8_250, distance: 3.5, hop: 2.8 },
  { start: 8_550, contact: 9_200, end: 9_850, distance: 2.5, hop: 2.1 },
] as const;
const FINAL_SWAT = { start: 9_850, contact: 10_300, end: 10_850 } as const;

type Point = readonly [x: number, y: number];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function loopTime(elapsedMs: number): number {
  const finiteTime = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  return ((finiteTime % HUSH_CAT_BALL_DURATION_MS) + HUSH_CAT_BALL_DURATION_MS) %
    HUSH_CAT_BALL_DURATION_MS;
}

function safeDimension(value: number, maximum?: number): number {
  const finiteValue = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, maximum === undefined ? finiteValue : Math.min(maximum, finiteValue));
}

function pawExtension(time: number): number {
  for (const beat of [...PLAY_BEATS, FINAL_SWAT]) {
    if (time < beat.start || time > beat.end) continue;
    if (time <= beat.contact) {
      return easeOutCubic(clamp01((time - beat.start) / (beat.contact - beat.start)));
    }
    return 1 - easeOutCubic(clamp01((time - beat.contact) / (beat.end - beat.contact)));
  }
  return 0;
}

function playfulBallOffset(time: number): { x: number; lift: number } {
  let x = 0;
  let lift = 0;
  for (const beat of PLAY_BEATS) {
    const progress = clamp01((time - beat.contact) / 650);
    x += beat.distance * easeOutCubic(progress);
    if (progress > 0 && progress < 1) {
      lift = Math.max(lift, Math.sin(progress * Math.PI) * beat.hop);
    }
  }
  return { x, lift };
}

function followedBallOffset(time: number): number {
  let x = 0;
  for (const beat of PLAY_BEATS) {
    const progress = clamp01((time - beat.contact - 300) / 650);
    x += beat.distance * easeOutCubic(progress);
  }
  return x;
}

function drawCompact(width: number, time: number): HushAnimationFrame {
  const cells: HushAnimationCell[] = Array.from({ length: width }, () => ({
    text: " ",
    color: "muted",
  }));
  const paint = (column: number, text: string, color: HushAnimationColor): void => {
    if (column >= 0 && column < width) cells[column] = { text, color };
  };

  // One- and two-column allocations cannot hold a whole cat, but still preserve
  // the ordering of ball-first, cat-play, and rightward chase.
  if (width <= 2) {
    if (time < 4_300) {
      paint(Math.min(width - 1, Math.floor((time / 4_300) * width)), "o", "highlight");
    } else if (time < FINAL_SWAT.contact) {
      if (width === 2) {
        paint(0, "^", "accent");
        paint(1, "o", "highlight");
      } else if (Math.floor(time / 250) % 2 === 0) {
        paint(0, "o", "highlight");
      } else {
        paint(0, "^", "accent");
      }
    } else if (time < 12_700) {
      paint(width - 1, "o", "highlight");
    } else {
      paint(width - 1, ">", "accent");
    }
    return composeHushAnimationCells(cells);
  }

  const restColumn = Math.min(width - 1, Math.round(width * 0.56));
  let ballColumn = restColumn;
  if (time < 2_400) {
    ballColumn = Math.round(restColumn * easeOutCubic(time / 2_400));
  } else {
    const playful = playfulBallOffset(time);
    ballColumn = Math.round(restColumn + playful.x * Math.max(0.08, width / 48));
    if (time >= FINAL_SWAT.contact) {
      const flight = clamp01((time - FINAL_SWAT.contact) / 2_900);
      ballColumn = Math.round(
        ballColumn + (width + 1 - ballColumn) * flight ** 1.55,
      );
    }
  }

  if (time >= 2_400) {
    const extension = pawExtension(time);
    const catBody = width >= 10 ? "=^.^=" : width >= 7 ? "^.^" : "^";
    const cat = extension > 0.46 ? `${catBody}-` : catBody;
    // Extending a paw must not shift the entire cat backwards by one cell.
    const settledStart =
      restColumn - catBody.length - 1 +
      Math.round(followedBallOffset(time) * Math.max(0.08, width / 48));
    let catStart: number;
    if (time < 4_300) {
      const arrival = easeOutCubic((time - 2_400) / 1_900);
      catStart = Math.round(-catBody.length + (settledStart + catBody.length) * arrival);
    } else if (time < 10_800) {
      catStart = settledStart;
    } else {
      const chase = clamp01((time - 10_800) / 3_200) ** 2;
      // Floor keeps the trailing edge visible until the exact loop boundary.
      catStart = Math.floor(settledStart + (width - settledStart) * chase);
    }
    for (let index = 0; index < cat.length; index += 1) {
      paint(catStart + index, cat[index]!, index < 2 ? "secondary" : "accent");
    }
  }

  // The ball is painted last and is the sole use of the peak highlight role.
  paint(ballColumn, "o", "highlight");
  return composeHushAnimationCells(cells);
}

function drawBraille(width: number, height: number, time: number): HushAnimationFrame {
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
  const line = (from: Point, to: Point, color: HushAnimationColor): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) * 1.5));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      put(
        from[0] + (to[0] - from[0]) * progress,
        from[1] + (to[1] - from[1]) * progress,
        color,
      );
    }
  };
  const curve = (
    from: Point,
    control: Point,
    to: Point,
    color: HushAnimationColor,
  ): void => {
    for (let step = 0; step <= 18; step += 1) {
      const progress = step / 18;
      const inverse = 1 - progress;
      put(
        inverse * inverse * from[0] +
          2 * inverse * progress * control[0] +
          progress * progress * to[0],
        inverse * inverse * from[1] +
          2 * inverse * progress * control[1] +
          progress * progress * to[1],
        color,
      );
    }
  };
  const ellipse = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: HushAnimationColor,
    upperOnly = false,
  ): void => {
    const steps = Math.max(16, Math.ceil((radiusX + radiusY) * 5));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      if (upperOnly && angle > 0 && angle < Math.PI) continue;
      put(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY, color);
    }
  };

  const scaleY = height === 2 ? 0.68 : 1;
  const ground = pixelHeight - 1;
  const ballRadius = height === 2 ? 1.35 : 1.7;
  const ballRestX = (pixelWidth - 1) * 0.55;
  const ballGroundY = ground - ballRadius;
  let ballX = ballRestX;
  let ballY = ballGroundY;
  if (time < 2_400) {
    const progress = time / 2_400;
    ballX = ballRestX * easeOutCubic(progress);
    const diminishingBounce = (1 - progress) * pixelHeight * 0.55;
    ballY -= Math.abs(Math.sin(progress * Math.PI * 3)) * diminishingBounce;
  } else {
    const playful = playfulBallOffset(time);
    ballX += playful.x;
    ballY -= playful.lift * scaleY;
    if (time >= FINAL_SWAT.contact) {
      const flight = clamp01((time - FINAL_SWAT.contact) / 2_900);
      ballX += (pixelWidth + ballRadius * 2 - ballX) * flight ** 1.55;
      ballY -= pixelHeight * 1.8 * flight * (1 - flight);
    }
  }

  if (time >= 2_400) {
    const settledCatX = ballRestX - 11 + followedBallOffset(time);
    let catX: number;
    if (time < 4_300) {
      catX = -13 + (settledCatX + 13) * easeOutCubic((time - 2_400) / 1_900);
    } else if (time < 10_800) {
      catX = settledCatX;
    } else {
      const chase = clamp01((time - 10_800) / 3_200) ** 2;
      catX = settledCatX + (pixelWidth + 13.5 - settledCatX) * chase;
    }

    const extension = pawExtension(time);
    const playing = time >= 4_300 && time < 10_850;
    const crouch = playing ? 0.55 + Math.sin(time / 180) * 0.22 : 0;
    const walking = time < 4_300 || time >= 10_800;
    const stride = walking ? Math.sin(time / 125) * 1.15 : 0;
    const bodyY = ground - (3 - crouch) * scaleY;
    const headY = ground - (6 - crouch) * scaleY +
      (time >= 4_300 && time < 5_000 ? 0.7 * scaleY : 0);
    const tailFlick = Math.sin(time / (playing ? 145 : 260));

    // Keep the curl and flick, but shorten the tail around its fixed attachment.
    const tailRoot: Point = [catX - 4.5, bodyY];
    const tailPoint = (x: number, y: number): Point => [
      tailRoot[0] + (x - tailRoot[0]) * 0.8,
      tailRoot[1] + (y - tailRoot[1]) * 0.8,
    ];
    curve(
      tailRoot,
      tailPoint(catX - 9, ground - 1.2 * scaleY),
      tailPoint(catX - 11.5, ground - 4.2 * scaleY),
      "muted",
    );
    curve(
      tailPoint(catX - 11.5, ground - 4.2 * scaleY),
      tailPoint(catX - 13.2, ground - (7.6 + tailFlick) * scaleY),
      tailPoint(catX - 9.6 + tailFlick, ground - 7.1 * scaleY),
      "secondary",
    );

    // Short panes use an open back and two legs instead of compressing a belly,
    // fur details and three feet into one dense horizontal band.
    ellipse(catX, bodyY, 5.2, 2.05 * scaleY, "accent", height === 2);
    if (height === 3) {
      line([catX - 4.4, bodyY - 0.7 * scaleY], [catX + 3.3, bodyY - 1.25 * scaleY], "accent");
      put(catX - 2, bodyY, "tertiary");
      put(catX + 0.5, bodyY + 0.3 * scaleY, "secondary");
    }

    // Pointed ears, round cheeks, eyes, nose, and whiskers form the cat's face.
    ellipse(catX + 5, headY, 2.8, 2.15 * scaleY, "tertiary");
    line(
      [catX + 2.8, headY - 1.2 * scaleY],
      [catX + 3.1, ground - 10 * scaleY + crouch * scaleY],
      "accent",
    );
    line(
      [catX + 3.1, ground - 10 * scaleY + crouch * scaleY],
      [catX + 4.4, headY - 1.8 * scaleY],
      "accent",
    );
    line(
      [catX + 5.7, headY - 1.8 * scaleY],
      [catX + 7.1, ground - 9.8 * scaleY + crouch * scaleY],
      "accent",
    );
    line(
      [catX + 7.1, ground - 9.8 * scaleY + crouch * scaleY],
      [catX + 7.3, headY - 1 * scaleY],
      "accent",
    );
    if (height === 3) put(catX + 4.2, headY - 0.2 * scaleY, "secondary");
    put(catX + 6.1, headY - 0.2 * scaleY, "secondary");
    put(catX + 7.4, headY + 0.65 * scaleY, "muted");
    line([catX + 6.7, headY + 0.8 * scaleY], [catX + 9.1, headY + 0.1 * scaleY], "muted");
    if (height === 3) {
      line([catX + 6.7, headY + 1.1 * scaleY], [catX + 9.2, headY + 1.6 * scaleY], "muted");
    }

    // Hind and planted forelegs animate independently during arrival and chase.
    line([catX - 3.2, bodyY + (height === 2 ? -0.3 : 1.1) * scaleY], [catX - 3.4 + stride, ground], "secondary");
    if (height === 3) {
      line([catX - 0.4, bodyY + 1.45 * scaleY], [catX + 0.2 - stride, ground], "secondary");
    }
    if (extension < 0.08) {
      line([catX + 2.7, bodyY + 0.4 * scaleY], [catX + 3.1 + stride * 0.45, ground], "tertiary");
    } else {
      // At full extension the paw reaches the ball's left edge; each ball hop
      // starts at that same contact timestamp rather than moving independently.
      const shoulder: Point = [catX + 2.5, bodyY + 0.15 * scaleY];
      const paw: Point = [
        catX + 3.1 + 6.4 * extension,
        bodyY + (2.3 - 2.05 * extension) * scaleY,
      ];
      curve(shoulder, [catX + 5.2, bodyY + 1.5 * scaleY], paw, "tertiary");
      line([paw[0] - 0.5, paw[1]], [paw[0] + 0.7, paw[1] + 0.15], "secondary");
    }
  }

  // A filled multi-dot circle stays visually distinct from the cat's fine lines.
  for (let y = Math.floor(ballY - ballRadius); y <= Math.ceil(ballY + ballRadius); y += 1) {
    for (let x = Math.floor(ballX - ballRadius); x <= Math.ceil(ballX + ballRadius); x += 1) {
      const dx = x - ballX;
      const dy = y - ballY;
      if (dx * dx + dy * dy <= ballRadius * ballRadius) put(x, y, "highlight");
    }
  }

  const rows = renderHushBrailleRows(pixels, width, height);
  return rows.length === 1 ? rows[0]! : { rows };
}

/** Render a deterministic ball-and-cat story on the host's fixed-time clock. */
export function renderHushCatBall(
  context: HushAnimationRenderContext,
): HushAnimationFrame {
  const width = safeDimension(context.width);
  const allocatedHeight = safeDimension(context.height, 3);
  const height =
    width < HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH ? 1 : allocatedHeight;
  const time = loopTime(context.elapsedMs);
  return height === 1
    ? drawCompact(width, time)
    : drawBraille(width, height, time);
}

export const HUSH_CAT_BALL_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "cat-ball",
  label: "Cat & Ball",
  description: "A fine-dot cat chases, paws, and bats a bouncing ball",
  intervalMs: HUSH_CAT_BALL_TICK_MS,
  width: { ratio: 1, minColumns: 18, maxColumns: 48 },
  maxHeight: 3,
  minWidthForMultiRow: HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH,
  placement: "aboveEditor",
  renderFrame: renderHushCatBall,
});
