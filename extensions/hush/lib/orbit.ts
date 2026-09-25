import {
  composeHushAnimationCells,
  type HushAnimationCell,
} from "./animation-cells.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
} from "./animation.ts";

export const HUSH_ORBIT_TICK_MS = 120;
export const HUSH_ORBIT_WIDTH = 9;
export const HUSH_ORBIT_PHASES = 16;

/** Project a satellite's circular path onto one compact terminal row. */
export function renderHushOrbit(
  context: HushAnimationFrameContext,
): HushAnimationFrame {
  const width = Math.max(1, Math.floor(context.width));
  const center = Math.floor(width / 2);
  const radius = Math.max(0, Math.floor((width - 3) / 2));
  const phase = ((context.frame % HUSH_ORBIT_PHASES) + HUSH_ORBIT_PHASES) %
    HUSH_ORBIT_PHASES;
  const angle = (phase * 2 * Math.PI) / HUSH_ORBIT_PHASES;
  const satellite = Math.max(
    0,
    Math.min(width - 1, center + Math.round(Math.cos(angle) * radius)),
  );
  const inFront = Math.sin(angle) >= 0;

  const cells: HushAnimationCell[] = Array.from(
    { length: width },
    () => ({ text: ".", color: "muted" }),
  );
  if (width >= 3) {
    cells[0] = { text: "(", color: "muted" };
    cells[width - 1] = { text: ")", color: "muted" };
  }
  cells[center] = { text: "O", color: "accent" };
  cells[satellite] = {
    text: satellite === center ? "@" : "o",
    color: inFront ? "highlight" : "secondary",
  };
  return composeHushAnimationCells(cells);
}

export const HUSH_ORBIT_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "orbit",
  label: "Orbit",
  description: "A satellite circling a compact central body",
  intervalMs: HUSH_ORBIT_TICK_MS,
  width: HUSH_ORBIT_WIDTH,
  maxHeight: 1,
  placement: "aboveEditor",
  renderFrame: renderHushOrbit,
});
