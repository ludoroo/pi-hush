import {
  composeHushAnimationCells,
  type HushAnimationCell,
} from "./animation-cells.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
} from "./animation.ts";

export const HUSH_SHOOTING_STAR_TICK_MS = 80;
export const HUSH_SHOOTING_STAR_TAIL_LENGTH = 3;

/** Send a shooting star across every column resolved by the host. */
export function renderHushShootingStar(
  context: HushAnimationFrameContext,
): HushAnimationFrame {
  const width = Math.max(1, Math.floor(context.width));
  const cycle = width + HUSH_SHOOTING_STAR_TAIL_LENGTH;
  const head = ((context.frame % cycle) + cycle) % cycle;
  const cells: HushAnimationCell[] = Array.from(
    { length: width },
    () => ({ text: ".", color: "muted" }),
  );

  const paint = (
    column: number,
    text: string,
    color: HushAnimationCell["color"],
  ): void => {
    if (column >= 0 && column < width) cells[column] = { text, color };
  };
  paint(head - 2, "-", "secondary");
  paint(head - 1, "-", "accent");
  paint(head, "*", "highlight");
  return composeHushAnimationCells(cells);
}

export const HUSH_SHOOTING_STAR_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "shooting-star",
  label: "Shooting star",
  description: "A shooting star travelling across all available width",
  intervalMs: HUSH_SHOOTING_STAR_TICK_MS,
  width: { ratio: 1 },
  maxHeight: 1,
  placement: "aboveEditor",
  renderFrame: renderHushShootingStar,
});
