import {
  composeHushAnimationCells,
  type HushAnimationCell,
} from "../lib/animation-cells.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
} from "../lib/animation.ts";

export const HUSH_JUMPING_DOTS_TICK_MS = 100;
export const HUSH_JUMPING_DOTS_WIDTH = 5;
export const HUSH_JUMPING_DOT_LEVELS = ["°", "°", "o", "ₒ", "ₒ", "o"] as const;

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Pass a compact high/middle/low bounce from the left dot to the right. */
export function renderHushJumpingDots(
  context: HushAnimationFrameContext,
): HushAnimationFrame {
  const width = Math.max(1, Math.floor(context.width));
  const dotCount = Math.min(3, width);
  const positions = Array.from({ length: dotCount }, (_, index) =>
    dotCount === 1
      ? 0
      : Math.round((index * (width - 1)) / (dotCount - 1)),
  );
  const cells: HushAnimationCell[] = Array.from(
    { length: width },
    () => ({ text: " ", color: "muted" }),
  );

  positions.forEach((column, index) => {
    const phase = positiveModulo(
      context.frame - index * 2,
      HUSH_JUMPING_DOT_LEVELS.length,
    );
    const text = HUSH_JUMPING_DOT_LEVELS[phase];
    cells[column] = {
      text,
      color: text === "°" ? "highlight" : text === "o" ? "accent" : "muted",
    };
  });
  return composeHushAnimationCells(cells);
}

export const HUSH_JUMPING_DOTS_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "jumping-dots",
  label: "Jumping dots",
  description: "Three hollow dots passing a bounce from left to right",
  intervalMs: HUSH_JUMPING_DOTS_TICK_MS,
  width: HUSH_JUMPING_DOTS_WIDTH,
  maxHeight: 1,
  placement: "aboveEditor",
  renderFrame: renderHushJumpingDots,
});
