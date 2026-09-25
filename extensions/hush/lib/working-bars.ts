import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
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

function barColor(level: number): HushAnimationColor {
  if (level === BAR_LEVELS.length - 1) return "highlight";
  if (level >= 6) return "secondary";
  if (level >= 4) return "accent";
  if (level >= 2) return "tertiary";
  return "muted";
}

export function renderHushWorkingBars(
  context: HushAnimationFrameContext,
): HushAnimationFrame {
  return {
    segments: Array.from({ length: context.width }, (_, column) => {
      const level = hushWorkingBarLevel(column, context.frame);
      return {
        text: BAR_LEVELS[level],
        color: barColor(level),
      };
    }),
  };
}

export const HUSH_WORKING_BARS_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "bars",
  label: "Equalizer bars",
  description: "Compact equalizer bars coloured by the active theme",
  maxHeight: HUSH_WORKING_BARS_MAX_HEIGHT,
  placement: "aboveEditor",
  intervalMs: HUSH_WORKING_BARS_TICK_MS,
  width: HUSH_WORKING_BARS_WIDTH,
  renderFrame: renderHushWorkingBars,
});
