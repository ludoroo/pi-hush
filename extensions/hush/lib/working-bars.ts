import {
  defineHushWorkingAnimation,
  type HushAnimationFrameContext,
} from "./working-animation.ts";

export const HUSH_WORKING_BARS_TICK_MS = 90;
export const HUSH_WORKING_BARS_MAX_HEIGHT = 1;
export const HUSH_WORKING_BARS_WIDTH = 10;

const BAR_LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Deterministic equalizer levels; no random state means frames are easy to resume. */
function hushWorkingBarLevel(column: number, frame: number): number {
  const primary = Math.sin(frame * 0.72 + column * 1.17);
  const secondary = Math.sin(frame * -0.31 + column * 0.63);
  const normalized = (primary + secondary + 2) / 4;
  return Math.max(
    0,
    Math.min(BAR_LEVELS.length - 1, Math.round(normalized * 7)),
  );
}

export function renderHushWorkingBarCells(
  width: number,
  frame: number,
): string {
  let bars = "";
  for (let column = 0; column < width; column += 1) {
    bars += BAR_LEVELS[hushWorkingBarLevel(column, frame)];
  }
  return bars;
}

export function renderHushWorkingBars(
  context: HushAnimationFrameContext,
): string[] {
  if (context.width === 0) return [];

  let bars = "";
  for (let column = 0; column < context.width; column += 1) {
    const level = hushWorkingBarLevel(column, context.frame);
    const glyph = BAR_LEVELS[level];
    if (level === BAR_LEVELS.length - 1) {
      bars += context.palette.highlight(glyph);
    } else if (level >= 6) {
      bars += context.palette.secondary(glyph);
    } else if (level >= 4) {
      bars += context.palette.accent(glyph);
    } else if (level >= 2) {
      bars += context.palette.tertiary(glyph);
    } else {
      bars += context.palette.muted(glyph);
    }
  }
  return [bars];
}

export const HUSH_WORKING_BARS_ANIMATION = defineHushWorkingAnimation({
  id: "bars",
  label: "Equalizer bars",
  description: "Compact equalizer bars coloured by the active theme",
  maxHeight: HUSH_WORKING_BARS_MAX_HEIGHT,
  placement: "aboveEditor",
  intervalMs: HUSH_WORKING_BARS_TICK_MS,
  width: HUSH_WORKING_BARS_WIDTH,
  renderFrame: renderHushWorkingBars,
});
